/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type {
  Config,
  GeminiClient,
  ServerGeminiStreamEvent as GeminiEvent,
  ServerGeminiContentEvent as ContentEvent,
  ServerGeminiErrorEvent as ErrorEvent,
  ServerGeminiChatCompressedEvent,
  ServerGeminiFinishedEvent,
  ToolCallRequestInfo,
  EditorType,
  ThoughtSummary,
} from '@qwen-code/qwen-code-core';
import {
  GeminiEventType as ServerGeminiEventType,
  getErrorMessage,
  isNodeError,
  MessageSenderType,
  logUserPrompt,
  GitService,
  UnauthorizedError,
  UserPromptEvent,
  DEFAULT_GEMINI_FLASH_MODEL,
  logConversationFinishedEvent,
  ConversationFinishedEvent,
  ApprovalMode,
  parseAndFormatApiError,
  RetryExhaustedError,
} from '@qwen-code/qwen-code-core';
import { type Part, type PartListUnion, FinishReason } from '@google/genai';
import type {
  HistoryItem,
  HistoryItemWithoutId,
  HistoryItemToolGroup,
  HistoryItemUser,
  HistoryItemUserShell,
  HistoryItemGemini,
  HistoryItemGeminiContent,
  SlashCommandProcessorResult,
} from '../types.js';
import { StreamingState, MessageType, ToolCallStatus } from '../types.js';
import { isAtCommand, isSlashCommand } from '../utils/commandUtils.js';
import { useShellCommandProcessor } from './shellCommandProcessor.js';
import { useVisionAutoSwitch } from './useVisionAutoSwitch.js';
import { handleAtCommand } from './atCommandProcessor.js';
import { findLastSafeSplitPoint } from '../utils/markdownUtilities.js';
import { useStateAndRef } from './useStateAndRef.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import { useLogger } from './useLogger.js';
import type {
  TrackedToolCall,
  TrackedCompletedToolCall,
  TrackedCancelledToolCall,
} from './useReactToolScheduler.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  useReactToolScheduler,
  mapToDisplay as mapTrackedToolCallsToDisplay,
} from './useReactToolScheduler.js';
import { useSessionStats } from '../contexts/SessionContext.js';
import { useKeypress } from './useKeypress.js';

enum StreamProcessingStatus {
  Completed,
  UserCancelled,
  Error,
  RetryLimitExceeded,
}

const STREAM_RETRY_LIMIT = Number.parseInt(
  process.env['QWEN_STREAM_RETRY_LIMIT'] ?? '',
  10,
) || 3;
const AUTO_RECOVERY_MAX_ATTEMPTS = 1;
const LOOP_RECOVERY_MAX_ATTEMPTS = Number.parseInt(
  process.env['QWEN_LOOP_RECOVERY_LIMIT'] ?? '',
  10,
) || 1;
const PROVIDER_RECOVERY_MAX_ATTEMPTS = Number.parseInt(
  process.env['QWEN_PROVIDER_RECOVERY_LIMIT'] ?? '',
  10,
) || 1;
const LIMIT_RECOVERY_MAX_ATTEMPTS = Number.parseInt(
  process.env['QWEN_LIMIT_RECOVERY_LIMIT'] ?? '',
  10,
) || 1;
const FINISH_RECOVERY_MAX_ATTEMPTS = Number.parseInt(
  process.env['QWEN_FINISH_RECOVERY_LIMIT'] ?? '',
  10,
) || 1;

type HistoryEntry = HistoryItem | HistoryItemWithoutId;
type SubmitQueryOptions = {
  isContinuation: boolean;
  skipLoopRecoveryReset?: boolean;
  skipProviderRecoveryReset?: boolean;
  skipLimitRecoveryReset?: boolean;
  skipFinishRecoveryReset?: boolean;
};
type RetryExhaustedErrorLike = RetryExhaustedError & {
  attempts: number;
  errorCodes: string[];
};

function truncateForLoopSummary(text: string | undefined, maxLength = 280): string {
  if (!text) {
    return '';
  }
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function buildContextSnapshot(
  history: HistoryItem[],
  pendingHistoryItem: HistoryItemWithoutId | null,
): string {
  const combinedHistory: HistoryEntry[] = pendingHistoryItem
    ? [...history, pendingHistoryItem]
    : [...history];

  if (combinedHistory.length === 0) {
    return '';
  }

  const reversedHistory = [...combinedHistory].reverse();

  const lastUserEntry = reversedHistory.find(
    (entry) => entry.type === 'user' || entry.type === 'user_shell',
  ) as (HistoryItemUser | HistoryItemUserShell) | undefined;

  const lastAssistantEntry = reversedHistory.find(
    (entry) => entry.type === 'gemini' || entry.type === 'gemini_content',
  ) as (HistoryItemGemini | HistoryItemGeminiContent) | undefined;

  const recentToolGroups = reversedHistory
    .filter(
      (entry): entry is HistoryItemToolGroup => entry.type === 'tool_group',
    )
    .slice(0, 2);

  const summarySegments: string[] = [];

  if (lastUserEntry?.text) {
      summarySegments.push(
        `Last user request: ${truncateForLoopSummary(lastUserEntry.text)}`,
      );
  }

  if (lastAssistantEntry?.text) {
    summarySegments.push(
      `Last assistant reply: ${truncateForLoopSummary(lastAssistantEntry.text)}`,
    );
  }

  if (recentToolGroups.length > 0) {
    const flattenedSummaries = recentToolGroups.flatMap((group) =>
      group.tools.map((tool) => `${tool.name}: ${tool.status.toLowerCase()}`),
    );
    const truncatedSummaries = flattenedSummaries.slice(0, 4);
    const hasMoreSummaries = flattenedSummaries.length > truncatedSummaries.length;

    if (truncatedSummaries.length > 0) {
      summarySegments.push(
        `Recent tool calls: ${truncatedSummaries.join(', ')}${
          hasMoreSummaries ? ', …' : ''
        }`,
      );
    }
  }

  return summarySegments.join('\n');
}

function buildLoopRecoveryPrompt(summary: string, attempt: number): string {
  const promptSections = [
    'System notice: The previous assistant turn was halted because a potential tool loop was detected. All pending tool activity was cancelled and state was reset.',
    summary ? `Recent context snapshot:\n${summary}` : undefined,
    'Realign with the user\'s plan, explain how you will break out of the loop, and continue the work without repeating the same tool sequence. Adjust parameters or choose an alternate tool if needed before proceeding.',
  ];

  if (attempt > 1) {
    promptSections.push(
      'This is an additional recovery attempt. Take a different approach immediately and be explicit about what changed.',
    );
  }

  return promptSections.filter(Boolean).join('\n\n');
}

function buildProviderFailurePrompt(
  summary: string,
  attempt: number,
  descriptor: string,
): string {
  const promptSections = [
    `System notice: The previous assistant turn failed repeatedly due to network or provider errors${
      descriptor ? ` ${descriptor}` : ''
    }. The chat session was reset to recover.`,
    summary ? `Recent context snapshot:\n${summary}` : undefined,
    'Reconfirm recent progress, outline the next concrete action, and choose a different strategy that reduces the chance of triggering the same failure (smaller tool inputs, shorter outputs, or staggered steps).',
  ];

  if (attempt > 1) {
    promptSections.push(
      'This is an additional recovery attempt. Change tactics immediately and explain what is different before proceeding.',
    );
  }

  return promptSections.filter(Boolean).join('\n\n');
}

function buildSessionLimitRecoveryPrompt(
  summary: string,
  attempt: number,
  limit: number,
  current: number,
): string {
  const promptSections = [
    `System notice: The previous turn was halted after exceeding the session token budget (${current.toLocaleString()} / ${limit.toLocaleString()}). The tool scheduler was reset to unblock progress.`,
    summary ? `Recent context snapshot:\n${summary}` : undefined,
    'Reconstruct the minimal context needed to continue, confirm what was last completed, and resume using concise steps. Prefer referencing prior work instead of repeating large outputs. Use /compress or produce summarized references before invoking tools again.',
  ];

  if (attempt > 1) {
    promptSections.push(
      'This is an additional recovery attempt. Switch to a tighter strategy immediately (smaller batches, more summaries, or checkpoints) before proceeding.',
    );
  }

  return promptSections.filter(Boolean).join('\n\n');
}

function buildTurnLimitRecoveryPrompt(
  summary: string,
  attempt: number,
  maxTurns: number,
): string {
  const promptSections = [
    `System notice: The session reached the configured turn cap (${maxTurns}). Pending tool activity was cancelled so the workflow can resume safely.`,
    summary ? `Recent context snapshot:\n${summary}` : undefined,
    'Summarize what remains, decide whether to finish the task or create a fresh session, and continue with the highest-priority next action.',
  ];

  if (attempt > 1) {
    promptSections.push(
      'This is an additional recovery attempt. Consolidate open threads, close out redundant loops, and proceed only with the essential steps.',
    );
  }

  return promptSections.filter(Boolean).join('\n\n');
}

function buildTurnBudgetRecoveryPrompt(
  summary: string,
  attempt: number,
  limit: number | null,
): string {
  const limitText =
    typeof limit === 'number' && limit > 0
      ? `${limit.toLocaleString()} turns`
      : 'the configured budget';
  const promptSections = [
    `System notice: The automatic turn budget (${limitText}) was reached while the assistant continued autonomously. Pending tool activity was cancelled so the workflow can be reassessed.`,
    summary ? `Recent context snapshot:\n${summary}` : undefined,
    'Summarize the latest progress, note what remains, and proceed with a concise next action. If the work needs more thinking time, explain why and continue with deliberate steps.',
  ];

  if (attempt > 1) {
    promptSections.push(
      'This is an additional recovery attempt. Adjust your strategy immediately—favor shorter plans or break the task into smaller sub-steps before continuing.',
    );
  }

  return promptSections.filter(Boolean).join('\n\n');
}

const FINISH_REASON_RECOVERY_GUIDANCE: Partial<Record<FinishReason, string>> = {
  [FinishReason.MAX_TOKENS]:
    'Resume from the last complete point but keep outputs short. Split long responses into numbered follow-ups or delegate subtasks so no single reply approaches the limit.',
  [FinishReason.MALFORMED_FUNCTION_CALL]:
    'Audit the most recent tool call arguments, correct the schema, and reissue the call. Double-check parameter names and required fields before retrying.',
  [FinishReason.SAFETY]:
    'Restate the plan with a safe framing, acknowledge the restriction, and offer compliant alternative steps before continuing.',
  [FinishReason.PROHIBITED_CONTENT]:
    'Remove any restricted content from the approach, explain the adjustment, and provide a compliant alternative path to advance the task.',
  [FinishReason.RECITATION]:
    'Provide an original summary or explanation instead of quoting large passages. Reference sources qualitatively and keep excerpts short.',
  [FinishReason.BLOCKLIST]:
    'Avoid the blocked terms, clarify the constraint to the user, and proceed with acceptable terminology.',
  [FinishReason.IMAGE_SAFETY]:
    'Skip generating the blocked image content and outline safe next steps or alternative representations.',
  [FinishReason.OTHER]:
    'Clarify what prevented completion, adjust the strategy, and continue with a revised plan.',
};

function buildFinishReasonRecoveryPrompt(
  summary: string,
  reason: FinishReason,
  attempt: number,
): string {
  const guidance = FINISH_REASON_RECOVERY_GUIDANCE[reason];
  if (!guidance) {
    return '';
  }

  const reasonLabel = FinishReason[reason] ?? 'UNKNOWN';
  const promptSections = [
    `System notice: The previous response ended early because of ${reasonLabel}.`,
    summary ? `Recent context snapshot:\n${summary}` : undefined,
    guidance,
  ];

  if (attempt > 1) {
    promptSections.push(
      'This is an additional recovery attempt. Change tactics immediately and justify how the new plan avoids the same stop condition.',
    );
  }

  return promptSections.filter(Boolean).join('\n\n');
}

/**
 * Manages the Gemini stream, including user input, command processing,
 * API interaction, and tool call lifecycle.
 */
export const useGeminiStream = (
  geminiClient: GeminiClient,
  history: HistoryItem[],
  addItem: UseHistoryManagerReturn['addItem'],
  config: Config,
  onDebugMessage: (message: string) => void,
  handleSlashCommand: (
    cmd: PartListUnion,
  ) => Promise<SlashCommandProcessorResult | false>,
  shellModeActive: boolean,
  getPreferredEditor: () => EditorType | undefined,
  onAuthError: () => void,
  performMemoryRefresh: () => Promise<void>,
  modelSwitchedFromQuotaError: boolean,
  setModelSwitchedFromQuotaError: React.Dispatch<React.SetStateAction<boolean>>,
  onEditorClose: () => void,
  onCancelSubmit: () => void,
  visionModelPreviewEnabled: boolean = false,
  onVisionSwitchRequired?: (query: PartListUnion) => Promise<{
    modelOverride?: string;
    persistSessionModel?: string;
    showGuidance?: boolean;
  }>,
) => {
  const [initError, setInitError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const turnCancelledRef = useRef(false);
  const isSubmittingQueryRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const autoRecoveryAttemptsRef = useRef(0);
  const pendingAutoRecoveryRef = useRef<
    {
      promptId: string;
      query: PartListUnion;
      timestamp: number;
      isContinuation?: boolean;
      skipLoopReset?: boolean;
      skipProviderReset?: boolean;
      skipLimitReset?: boolean;
      skipFinishReset?: boolean;
    } | null
  >(null);
  const loopRecoveryAttemptsRef = useRef(0);
  const providerFailureRecoveryAttemptsRef = useRef(0);
  const limitRecoveryAttemptsRef = useRef(0);
  const finishRecoveryAttemptsRef = useRef(0);
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const [thought, setThought] = useState<ThoughtSummary | null>(null);
  const [pendingHistoryItemRef, setPendingHistoryItem] =
    useStateAndRef<HistoryItemWithoutId | null>(null);
  const processedMemoryToolsRef = useRef<Set<string>>(new Set());
  const { startNewPrompt, getPromptCount } = useSessionStats();
  const storage = config.storage;
  const logger = useLogger(storage);
  const gitService = useMemo(() => {
    if (!config.getProjectRoot()) {
      return;
    }
    return new GitService(config.getProjectRoot(), storage);
  }, [config, storage]);

  const [toolCalls, scheduleToolCalls, markToolsAsSubmitted, resetToolScheduler] =
    useReactToolScheduler(
      async (completedToolCallsFromScheduler) => {
        // This onComplete is called when ALL scheduled tools for a given batch are done.
        if (completedToolCallsFromScheduler.length > 0) {
          // Add the final state of these tools to the history for display.
          addItem(
            mapTrackedToolCallsToDisplay(
              completedToolCallsFromScheduler as TrackedToolCall[],
            ),
            Date.now(),
          );

          // Handle tool response submission immediately when tools complete
          await handleCompletedTools(
            completedToolCallsFromScheduler as TrackedToolCall[],
          );
        }
      },
      config,
      setPendingHistoryItem,
      getPreferredEditor,
      onEditorClose,
    );

  const pendingToolCallGroupDisplay = useMemo(
    () =>
      toolCalls.length ? mapTrackedToolCallsToDisplay(toolCalls) : undefined,
    [toolCalls],
  );

  const loopDetectedRef = useRef(false);

  const onExec = useCallback(async (done: Promise<void>) => {
    setIsResponding(true);
    await done;
    setIsResponding(false);
  }, []);
  const { handleShellCommand } = useShellCommandProcessor(
    addItem,
    setPendingHistoryItem,
    onExec,
    onDebugMessage,
    config,
    geminiClient,
  );

  const { handleVisionSwitch, restoreOriginalModel } = useVisionAutoSwitch(
    config,
    addItem,
    visionModelPreviewEnabled,
    onVisionSwitchRequired,
  );

  const streamingState = useMemo(() => {
    if (toolCalls.some((tc) => tc.status === 'awaiting_approval')) {
      return StreamingState.WaitingForConfirmation;
    }
    if (
      isResponding ||
      toolCalls.some(
        (tc) =>
          tc.status === 'executing' ||
          tc.status === 'scheduled' ||
          tc.status === 'validating' ||
          ((tc.status === 'success' ||
            tc.status === 'error' ||
            tc.status === 'cancelled') &&
            !(tc as TrackedCompletedToolCall | TrackedCancelledToolCall)
              .responseSubmittedToGemini),
      )
    ) {
      return StreamingState.Responding;
    }
    return StreamingState.Idle;
  }, [isResponding, toolCalls]);

  useEffect(() => {
    if (
      config.getApprovalMode() === ApprovalMode.YOLO &&
      streamingState === StreamingState.Idle
    ) {
      const lastUserMessageIndex = history.findLastIndex(
        (item: HistoryItem) => item.type === MessageType.USER,
      );

      const turnCount =
        lastUserMessageIndex === -1 ? 0 : history.length - lastUserMessageIndex;

      if (turnCount > 0) {
        logConversationFinishedEvent(
          config,
          new ConversationFinishedEvent(config.getApprovalMode(), turnCount),
        );
      }
    }
  }, [streamingState, config, history]);

  const cancelOngoingRequest = useCallback(() => {
    if (streamingState !== StreamingState.Responding) {
      return;
    }
    if (turnCancelledRef.current) {
      return;
    }
    turnCancelledRef.current = true;
    isSubmittingQueryRef.current = false;
    abortControllerRef.current?.abort();
    if (pendingHistoryItemRef.current) {
      addItem(pendingHistoryItemRef.current, Date.now());
    }
    addItem(
      {
        type: MessageType.INFO,
        text: 'Request cancelled.',
      },
      Date.now(),
    );
    setPendingHistoryItem(null);
    onCancelSubmit();
    setIsResponding(false);
  }, [
    streamingState,
    addItem,
    setPendingHistoryItem,
    onCancelSubmit,
    pendingHistoryItemRef,
  ]);

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        cancelOngoingRequest();
      }
    },
    { isActive: streamingState === StreamingState.Responding },
  );

  const prepareQueryForGemini = useCallback(
    async (
      query: PartListUnion,
      userMessageTimestamp: number,
      abortSignal: AbortSignal,
      prompt_id: string,
    ): Promise<{
      queryToSend: PartListUnion | null;
      shouldProceed: boolean;
    }> => {
      if (turnCancelledRef.current) {
        return { queryToSend: null, shouldProceed: false };
      }
      if (typeof query === 'string' && query.trim().length === 0) {
        return { queryToSend: null, shouldProceed: false };
      }

      let localQueryToSendToGemini: PartListUnion | null = null;

      if (typeof query === 'string') {
        const trimmedQuery = query.trim();
        logUserPrompt(
          config,
          new UserPromptEvent(
            trimmedQuery.length,
            prompt_id,
            config.getContentGeneratorConfig()?.authType,
            trimmedQuery,
          ),
        );
        onDebugMessage(`User query: '${trimmedQuery}'`);
        await logger?.logMessage(MessageSenderType.USER, trimmedQuery);

        // Handle UI-only commands first
        const slashCommandResult = isSlashCommand(trimmedQuery)
          ? await handleSlashCommand(trimmedQuery)
          : false;

        if (slashCommandResult) {
          switch (slashCommandResult.type) {
            case 'schedule_tool': {
              const { toolName, toolArgs } = slashCommandResult;
              const toolCallRequest: ToolCallRequestInfo = {
                callId: `${toolName}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                name: toolName,
                args: toolArgs,
                isClientInitiated: true,
                prompt_id,
              };
              scheduleToolCalls([toolCallRequest], abortSignal);
              return { queryToSend: null, shouldProceed: false };
            }
            case 'submit_prompt': {
              localQueryToSendToGemini = slashCommandResult.content;

              return {
                queryToSend: localQueryToSendToGemini,
                shouldProceed: true,
              };
            }
            case 'handled': {
              return { queryToSend: null, shouldProceed: false };
            }
            default: {
              const unreachable: never = slashCommandResult;
              throw new Error(
                `Unhandled slash command result type: ${unreachable}`,
              );
            }
          }
        }

        if (shellModeActive && handleShellCommand(trimmedQuery, abortSignal)) {
          return { queryToSend: null, shouldProceed: false };
        }

        // Handle @-commands (which might involve tool calls)
        if (isAtCommand(trimmedQuery)) {
          const atCommandResult = await handleAtCommand({
            query: trimmedQuery,
            config,
            addItem,
            onDebugMessage,
            messageId: userMessageTimestamp,
            signal: abortSignal,
          });

          // Add user's turn after @ command processing is done.
          addItem(
            { type: MessageType.USER, text: trimmedQuery },
            userMessageTimestamp,
          );

          if (!atCommandResult.shouldProceed) {
            return { queryToSend: null, shouldProceed: false };
          }
          localQueryToSendToGemini = atCommandResult.processedQuery;
        } else {
          // Normal query for Gemini
          addItem(
            { type: MessageType.USER, text: trimmedQuery },
            userMessageTimestamp,
          );
          localQueryToSendToGemini = trimmedQuery;
        }
      } else {
        // It's a function response (PartListUnion that isn't a string)
        localQueryToSendToGemini = query;
      }

      if (localQueryToSendToGemini === null) {
        onDebugMessage(
          'Query processing resulted in null, not sending to Gemini.',
        );
        return { queryToSend: null, shouldProceed: false };
      }
      return { queryToSend: localQueryToSendToGemini, shouldProceed: true };
    },
    [
      config,
      addItem,
      onDebugMessage,
      handleShellCommand,
      handleSlashCommand,
      logger,
      shellModeActive,
      scheduleToolCalls,
    ],
  );

  // --- Stream Event Handlers ---

  const handleContentEvent = useCallback(
    (
      eventValue: ContentEvent['value'],
      currentGeminiMessageBuffer: string,
      userMessageTimestamp: number,
    ): string => {
      if (turnCancelledRef.current) {
        // Prevents additional output after a user initiated cancel.
        return '';
      }
      let newGeminiMessageBuffer = currentGeminiMessageBuffer + eventValue;
      if (
        pendingHistoryItemRef.current?.type !== 'gemini' &&
        pendingHistoryItemRef.current?.type !== 'gemini_content'
      ) {
        if (pendingHistoryItemRef.current) {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        }
        setPendingHistoryItem({ type: 'gemini', text: '' });
        newGeminiMessageBuffer = eventValue;
      }
      // Split large messages for better rendering performance. Ideally,
      // we should maximize the amount of output sent to <Static />.
      const splitPoint = findLastSafeSplitPoint(newGeminiMessageBuffer);
      if (splitPoint === newGeminiMessageBuffer.length) {
        // Update the existing message with accumulated content
        setPendingHistoryItem((item) => ({
          type: item?.type as 'gemini' | 'gemini_content',
          text: newGeminiMessageBuffer,
        }));
      } else {
        // This indicates that we need to split up this Gemini Message.
        // Splitting a message is primarily a performance consideration. There is a
        // <Static> component at the root of App.tsx which takes care of rendering
        // content statically or dynamically. Everything but the last message is
        // treated as static in order to prevent re-rendering an entire message history
        // multiple times per-second (as streaming occurs). Prior to this change you'd
        // see heavy flickering of the terminal. This ensures that larger messages get
        // broken up so that there are more "statically" rendered.
        const beforeText = newGeminiMessageBuffer.substring(0, splitPoint);
        const afterText = newGeminiMessageBuffer.substring(splitPoint);
        addItem(
          {
            type: pendingHistoryItemRef.current?.type as
              | 'gemini'
              | 'gemini_content',
            text: beforeText,
          },
          userMessageTimestamp,
        );
        setPendingHistoryItem({ type: 'gemini_content', text: afterText });
        newGeminiMessageBuffer = afterText;
      }
      return newGeminiMessageBuffer;
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem],
  );

  const handleUserCancelledEvent = useCallback(
    (userMessageTimestamp: number) => {
      if (turnCancelledRef.current) {
        return;
      }
      if (pendingHistoryItemRef.current) {
        if (pendingHistoryItemRef.current.type === 'tool_group') {
          const updatedTools = pendingHistoryItemRef.current.tools.map(
            (tool) =>
              tool.status === ToolCallStatus.Pending ||
              tool.status === ToolCallStatus.Confirming ||
              tool.status === ToolCallStatus.Executing
                ? { ...tool, status: ToolCallStatus.Canceled }
                : tool,
          );
          const pendingItem: HistoryItemToolGroup = {
            ...pendingHistoryItemRef.current,
            tools: updatedTools,
          };
          addItem(pendingItem, userMessageTimestamp);
        } else {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        }
        setPendingHistoryItem(null);
      }
      addItem(
        { type: MessageType.INFO, text: 'User cancelled the request.' },
        userMessageTimestamp,
      );
      setIsResponding(false);
      setThought(null); // Reset thought when user cancels
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem, setThought],
  );

  const handleErrorEvent = useCallback(
    (eventValue: ErrorEvent['value'], userMessageTimestamp: number) => {
      if (pendingHistoryItemRef.current) {
        addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        setPendingHistoryItem(null);
      }
      addItem(
        {
          type: MessageType.ERROR,
          text: parseAndFormatApiError(
            eventValue.error,
            config.getContentGeneratorConfig()?.authType,
            undefined,
            config.getModel(),
            DEFAULT_GEMINI_FLASH_MODEL,
          ),
        },
        userMessageTimestamp,
      );
      setThought(null); // Reset thought when there's an error
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem, config, setThought],
  );

  const handleFinishedEvent = useCallback(
    (
      event: ServerGeminiFinishedEvent,
      userMessageTimestamp: number,
      promptId: string,
    ) => {
      const finishReason = event.value;

      const finishReasonMessages: Record<FinishReason, string | undefined> = {
        [FinishReason.FINISH_REASON_UNSPECIFIED]: undefined,
        [FinishReason.STOP]: undefined,
        [FinishReason.MAX_TOKENS]: 'Response truncated due to token limits.',
        [FinishReason.SAFETY]: 'Response stopped due to safety reasons.',
        [FinishReason.RECITATION]: 'Response stopped due to recitation policy.',
        [FinishReason.LANGUAGE]:
          'Response stopped due to unsupported language.',
        [FinishReason.BLOCKLIST]: 'Response stopped due to forbidden terms.',
        [FinishReason.PROHIBITED_CONTENT]:
          'Response stopped due to prohibited content.',
        [FinishReason.SPII]:
          'Response stopped due to sensitive personally identifiable information.',
        [FinishReason.OTHER]: 'Response stopped for other reasons.',
        [FinishReason.MALFORMED_FUNCTION_CALL]:
          'Response stopped due to malformed function call.',
        [FinishReason.IMAGE_SAFETY]:
          'Response stopped due to image safety violations.',
        [FinishReason.UNEXPECTED_TOOL_CALL]:
          'Response stopped due to unexpected tool call.',
      };

      const message = finishReasonMessages[finishReason];
      if (message) {
        addItem(
          {
            type: 'info',
            text: `⚠️  ${message}`,
          },
          userMessageTimestamp,
        );
      }

      if (pendingAutoRecoveryRef.current) {
        return;
      }

      const guidance = FINISH_REASON_RECOVERY_GUIDANCE[finishReason];
      if (!guidance) {
        return;
      }

      if (finishRecoveryAttemptsRef.current >= FINISH_RECOVERY_MAX_ATTEMPTS) {
        addItem(
          {
            type: MessageType.ERROR,
            text: 'Automatic recovery was skipped because finish-reason recovery already ran during this prompt. Please intervene manually.',
          },
          userMessageTimestamp,
        );
        return;
      }

      const summary = buildContextSnapshot(
        history,
        pendingHistoryItemRef.current,
      );

      const attemptNumber = finishRecoveryAttemptsRef.current + 1;
      finishRecoveryAttemptsRef.current = attemptNumber;

      const recoveryPromptText = buildFinishReasonRecoveryPrompt(
        summary,
        finishReason,
        attemptNumber,
      );

      if (!recoveryPromptText) {
        return;
      }

      const recoveryPromptId = `${promptId}-finish-recovery-${attemptNumber}`;

      pendingAutoRecoveryRef.current = {
        promptId: recoveryPromptId,
        query: [{ text: recoveryPromptText }],
        timestamp: userMessageTimestamp,
        isContinuation: false,
        skipLoopReset: true,
        skipProviderReset: true,
        skipLimitReset: true,
        skipFinishReset: true,
      };

      addItem(
        {
          type: MessageType.INFO,
          text: 'Attempting automatic recovery after the model stopped early...',
        },
        userMessageTimestamp,
      );
    },
    [
      addItem,
      pendingAutoRecoveryRef,
      history,
      pendingHistoryItemRef,
      finishRecoveryAttemptsRef,
    ],
  );

  const handleChatCompressionEvent = useCallback(
    (eventValue: ServerGeminiChatCompressedEvent['value']) =>
      addItem(
        {
          type: 'info',
          text:
            `IMPORTANT: This conversation approached the input token limit for ${config.getModel()}. ` +
            `A compressed context will be sent for future messages (compressed from: ` +
            `${eventValue?.originalTokenCount ?? 'unknown'} to ` +
            `${eventValue?.newTokenCount ?? 'unknown'} tokens).`,
        },
        Date.now(),
      ),
    [addItem, config],
  );

  const handleMaxSessionTurnsEvent = useCallback(
    (promptId: string, userMessageTimestamp: number): StreamProcessingStatus | null => {
      const timestamp = Date.now();
      addItem(
        {
          type: 'info',
          text:
            `The session has reached the maximum number of turns: ${config.getMaxSessionTurns()}. ` +
            `Please update this limit in your setting.json file.`,
        },
        timestamp,
      );

      abortControllerRef.current?.abort();
      resetToolScheduler('Turn limit reached. Scheduler reset for recovery.');
      setPendingHistoryItem(null);
      setThought(null);

      if (pendingAutoRecoveryRef.current) {
        return StreamProcessingStatus.Error;
      }

      if (limitRecoveryAttemptsRef.current >= LIMIT_RECOVERY_MAX_ATTEMPTS) {
        addItem(
          {
            type: MessageType.ERROR,
            text: 'Automatic recovery was skipped because turn-limit recovery already ran during this prompt. Please intervene manually.',
          },
          timestamp,
        );
        return StreamProcessingStatus.Error;
      }

      const summary = buildContextSnapshot(
        history,
        pendingHistoryItemRef.current,
      );

      const attemptNumber = limitRecoveryAttemptsRef.current + 1;
      limitRecoveryAttemptsRef.current = attemptNumber;

      const recoveryPromptId = `${promptId}-turn-limit-recovery-${attemptNumber}`;
      const recoveryPromptText = buildTurnLimitRecoveryPrompt(
        summary,
        attemptNumber,
        config.getMaxSessionTurns(),
      );

      pendingAutoRecoveryRef.current = {
        promptId: recoveryPromptId,
        query: [{ text: recoveryPromptText }],
        timestamp: userMessageTimestamp,
        isContinuation: false,
        skipLoopReset: true,
        skipProviderReset: true,
        skipLimitReset: true,
        skipFinishReset: true,
      };

      addItem(
        {
          type: MessageType.INFO,
          text: 'Attempting automatic recovery after hitting the turn limit...',
        },
        timestamp,
      );

      return StreamProcessingStatus.Error;
    },
    [
      addItem,
      config,
      history,
      pendingHistoryItemRef,
      resetToolScheduler,
      pendingAutoRecoveryRef,
      limitRecoveryAttemptsRef,
      abortControllerRef,
      setPendingHistoryItem,
      setThought,
    ],
  );

  const handleSessionTokenLimitExceededEvent = useCallback(
    (
      value: { currentTokens: number; limit: number; message: string },
      promptId: string,
      userMessageTimestamp: number,
    ): StreamProcessingStatus | null => {
      const timestamp = Date.now();
      addItem(
        {
          type: 'error',
          text:
            `🚫 Session token limit exceeded: ${value.currentTokens.toLocaleString()} tokens > ${value.limit.toLocaleString()} limit.\n\n` +
            `💡 Solutions:\n` +
            `   • Start a new session: Use /clear command\n` +
            `   • Increase limit: Add "sessionTokenLimit": (e.g., 128000) to your settings.json\n` +
            `   • Compress history: Use /compress command to compress history`,
        },
        timestamp,
      );

      abortControllerRef.current?.abort();
      resetToolScheduler('Session token limit triggered automatic recovery.');
      setPendingHistoryItem(null);
      setThought(null);

      if (pendingAutoRecoveryRef.current) {
        return StreamProcessingStatus.Error;
      }

      if (limitRecoveryAttemptsRef.current >= LIMIT_RECOVERY_MAX_ATTEMPTS) {
        addItem(
          {
            type: MessageType.ERROR,
            text: 'Automatic recovery was skipped because token-limit recovery already ran during this prompt. Please intervene manually.',
          },
          timestamp,
        );
        return StreamProcessingStatus.Error;
      }

      const summary = buildContextSnapshot(
        history,
        pendingHistoryItemRef.current,
      );

      const attemptNumber = limitRecoveryAttemptsRef.current + 1;
      limitRecoveryAttemptsRef.current = attemptNumber;

      const recoveryPromptId = `${promptId}-token-limit-recovery-${attemptNumber}`;
      const recoveryPromptText = buildSessionLimitRecoveryPrompt(
        summary,
        attemptNumber,
        value.limit,
        value.currentTokens,
      );

      pendingAutoRecoveryRef.current = {
        promptId: recoveryPromptId,
        query: [{ text: recoveryPromptText }],
        timestamp: userMessageTimestamp,
        isContinuation: false,
        skipLoopReset: true,
        skipProviderReset: true,
        skipLimitReset: true,
        skipFinishReset: true,
      };

      addItem(
        {
          type: MessageType.INFO,
          text: 'Attempting automatic recovery after session token overflow...',
        },
        timestamp,
      );

      return StreamProcessingStatus.Error;
    },
    [
      addItem,
      resetToolScheduler,
      pendingAutoRecoveryRef,
      limitRecoveryAttemptsRef,
      history,
      pendingHistoryItemRef,
      setPendingHistoryItem,
      setThought,
      abortControllerRef,
    ],
  );

  const handleTurnBudgetExceededEvent = useCallback(
    (
      value: { limit: number | null },
      promptId: string,
      userMessageTimestamp: number,
    ): StreamProcessingStatus | null => {
      const timestamp = Date.now();
      const limitText =
        typeof value.limit === 'number' && value.limit > 0
          ? value.limit.toLocaleString()
          : 'configured';
      addItem(
        {
          type: 'info',
          text: `The automatic turn budget (${limitText} turns) was reached. Pausing to reassess before continuing.`,
        },
        timestamp,
      );

      abortControllerRef.current?.abort();
      resetToolScheduler('Automatic turn budget reached. Scheduler reset for recovery.');
      setPendingHistoryItem(null);
      setThought(null);

      if (pendingAutoRecoveryRef.current) {
        return StreamProcessingStatus.Error;
      }

      if (limitRecoveryAttemptsRef.current >= LIMIT_RECOVERY_MAX_ATTEMPTS) {
        addItem(
          {
            type: MessageType.ERROR,
            text: 'Automatic recovery was skipped because the turn budget safeguard already triggered during this prompt. Please intervene manually.',
          },
          timestamp,
        );
        return StreamProcessingStatus.Error;
      }

      const summary = buildContextSnapshot(
        history,
        pendingHistoryItemRef.current,
      );

      const attemptNumber = limitRecoveryAttemptsRef.current + 1;
      limitRecoveryAttemptsRef.current = attemptNumber;

      const recoveryPromptId = `${promptId}-turn-budget-recovery-${attemptNumber}`;
      const recoveryPromptText = buildTurnBudgetRecoveryPrompt(
        summary,
        attemptNumber,
        value.limit ?? null,
      );

      pendingAutoRecoveryRef.current = {
        promptId: recoveryPromptId,
        query: [{ text: recoveryPromptText }],
        timestamp: userMessageTimestamp,
        isContinuation: false,
        skipLoopReset: true,
        skipProviderReset: true,
        skipLimitReset: true,
        skipFinishReset: true,
      };

      addItem(
        {
          type: MessageType.INFO,
          text: 'Attempting automatic recovery after reaching the turn budget...',
        },
        timestamp,
      );

      return StreamProcessingStatus.Error;
    },
    [
      addItem,
      resetToolScheduler,
      pendingAutoRecoveryRef,
      limitRecoveryAttemptsRef,
      history,
      pendingHistoryItemRef,
      setPendingHistoryItem,
      setThought,
      abortControllerRef,
    ],
  );

  const handleProviderFailureRecovery = useCallback(
    async (
      error: RetryExhaustedErrorLike,
      promptId: string,
      timestamp: number,
    ) => {
      const summary = buildContextSnapshot(
        history,
        pendingHistoryItemRef.current,
      );

      abortControllerRef.current?.abort();
      resetToolScheduler('Provider failure triggered automatic recovery.');
      setPendingHistoryItem(null);
      setThought(null);

      const descriptorParts: string[] = [];
      if (typeof error.status === 'number') {
        descriptorParts.push(`status ${error.status}`);
      }
      if (error.errorCodes.length > 0) {
        descriptorParts.push(`codes ${error.errorCodes.join(', ')}`);
      }
      const descriptor = descriptorParts.length
        ? ` (${descriptorParts.join(', ')})`
        : '';

      const infoSegments = [
        `⚠️ Provider request failed ${error.attempts} time${
          error.attempts === 1 ? '' : 's'
        }${descriptor}.`,
        error.lastError?.message
          ? `Last error: ${error.lastError.message}`
          : undefined,
        summary ? `Recovery snapshot:\n${summary}` : undefined,
      ].filter(Boolean);

      addItem(
        {
          type: MessageType.INFO,
          text: infoSegments.join('\n\n'),
        },
        timestamp,
      );

      let resetSucceeded = true;
      try {
        await geminiClient.resetChat();
      } catch (resetError) {
        resetSucceeded = false;
        addItem(
          {
            type: MessageType.ERROR,
            text: `Failed to reset chat after provider failure: ${getErrorMessage(resetError)}`,
          },
          Date.now(),
        );
      }

      if (!resetSucceeded || pendingAutoRecoveryRef.current) {
        return;
      }

      if (
        providerFailureRecoveryAttemptsRef.current >=
        PROVIDER_RECOVERY_MAX_ATTEMPTS
      ) {
        addItem(
          {
            type: MessageType.ERROR,
            text: 'Automatic recovery was skipped because provider failures have already triggered a recovery attempt during this turn. Please intervene manually.',
          },
          timestamp,
        );
        return;
      }

      providerFailureRecoveryAttemptsRef.current += 1;
      const attemptNumber = providerFailureRecoveryAttemptsRef.current;
      const promptDescriptor = descriptorParts.join(', ');
      const recoveryPromptText = buildProviderFailurePrompt(
        summary,
        attemptNumber,
        promptDescriptor,
      );
      const recoveryPromptId = `${promptId}-provider-recovery-${attemptNumber}`;

      pendingAutoRecoveryRef.current = {
        promptId: recoveryPromptId,
        query: [{ text: recoveryPromptText }],
        timestamp,
        isContinuation: false,
        skipLoopReset: true,
        skipProviderReset: true,
      };

      addItem(
        {
          type: MessageType.INFO,
          text: 'Attempting automatic recovery after repeated provider failures...',
        },
        timestamp,
      );
    },
    [
      history,
      addItem,
      pendingHistoryItemRef,
      abortControllerRef,
      resetToolScheduler,
      setPendingHistoryItem,
      setThought,
      geminiClient,
      pendingAutoRecoveryRef,
      providerFailureRecoveryAttemptsRef,
    ],
  );

  const handleLoopDetectedEvent = useCallback(
    (promptId: string) => {
      const timestamp = Date.now();
      const summary = buildContextSnapshot(
        history,
        pendingHistoryItemRef.current,
      );

      abortControllerRef.current?.abort();
      resetToolScheduler('Loop detection triggered automatic recovery.');

      const infoSegments = [
        '⚠️ Loop detection triggered. Pending tool calls were cancelled to prevent repetitive execution.',
        summary ? `Recovery snapshot:\n${summary}` : undefined,
      ].filter(Boolean);

      addItem(
        {
          type: MessageType.INFO,
          text: infoSegments.join('\n\n'),
        },
        timestamp,
      );

      if (pendingAutoRecoveryRef.current) {
        return;
      }

      if (loopRecoveryAttemptsRef.current >= LOOP_RECOVERY_MAX_ATTEMPTS) {
        addItem(
          {
            type: MessageType.ERROR,
            text: 'Automatic recovery was skipped because it has already been attempted for this turn. Please intervene manually.',
          },
          timestamp,
        );
        return;
      }

      const attemptNumber = loopRecoveryAttemptsRef.current + 1;
      loopRecoveryAttemptsRef.current = attemptNumber;

      const recoveryPromptText = buildLoopRecoveryPrompt(summary, attemptNumber);
      const recoveryPromptId = `${promptId}-loop-recovery-${attemptNumber}`;

      pendingAutoRecoveryRef.current = {
        promptId: recoveryPromptId,
        query: [{ text: recoveryPromptText }],
        timestamp,
        isContinuation: false,
        skipLoopReset: true,
      };

      addItem(
        {
          type: MessageType.INFO,
          text: 'Attempting automatic recovery to resume progress without repeating the loop...',
        },
        timestamp,
      );
    },
    [
      addItem,
      history,
      pendingHistoryItemRef,
      resetToolScheduler,
      pendingAutoRecoveryRef,
      loopRecoveryAttemptsRef,
      abortControllerRef,
    ],
  );

  const processGeminiStreamEvents = useCallback(
    async (
      stream: AsyncIterable<GeminiEvent>,
      userMessageTimestamp: number,
      signal: AbortSignal,
      promptId: string,
    ): Promise<StreamProcessingStatus> => {
      let geminiMessageBuffer = '';
      const toolCallRequests: ToolCallRequestInfo[] = [];
      for await (const event of stream) {
        switch (event.type) {
          case ServerGeminiEventType.Thought:
            setThought(event.value);
            break;
          case ServerGeminiEventType.Content:
            if (retryAttemptRef.current > 0) {
              retryAttemptRef.current = 0;
            }
            geminiMessageBuffer = handleContentEvent(
              event.value,
              geminiMessageBuffer,
              userMessageTimestamp,
            );
            break;
          case ServerGeminiEventType.ToolCallRequest:
            toolCallRequests.push(event.value);
            break;
          case ServerGeminiEventType.UserCancelled:
            handleUserCancelledEvent(userMessageTimestamp);
            break;
          case ServerGeminiEventType.Error:
            handleErrorEvent(event.value, userMessageTimestamp);
            break;
          case ServerGeminiEventType.ChatCompressed:
            handleChatCompressionEvent(event.value);
            break;
          case ServerGeminiEventType.ToolCallConfirmation:
          case ServerGeminiEventType.ToolCallResponse:
            // do nothing
            break;
          case ServerGeminiEventType.MaxSessionTurns:
            {
              const status = handleMaxSessionTurnsEvent(
                promptId,
                userMessageTimestamp,
              );
              if (status !== null) {
                return status;
              }
              break;
            }
          case ServerGeminiEventType.SessionTokenLimitExceeded:
            {
              const status = handleSessionTokenLimitExceededEvent(
                event.value,
                promptId,
                userMessageTimestamp,
              );
              if (status !== null) {
                return status;
              }
              break;
            }
          case ServerGeminiEventType.TurnBudgetExceeded:
            {
              const status = handleTurnBudgetExceededEvent(
                event.value,
                promptId,
                userMessageTimestamp,
              );
              if (status !== null) {
                return status;
              }
              break;
            }
          case ServerGeminiEventType.Finished:
            handleFinishedEvent(
              event as ServerGeminiFinishedEvent,
              userMessageTimestamp,
              promptId,
            );
            break;
          case ServerGeminiEventType.LoopDetected:
            // handle later because we want to move pending history to history
            // before we add loop detected message to history
            loopDetectedRef.current = true;
            break;
          case ServerGeminiEventType.Retry:
            retryAttemptRef.current += 1;
            setThought(null);
            geminiMessageBuffer = '';
            if (pendingHistoryItemRef.current) {
              setPendingHistoryItem(null);
            }
            addItem(
              {
                type: MessageType.INFO,
                text: `Model response stalled. Retrying attempt ${retryAttemptRef.current}/${STREAM_RETRY_LIMIT}...`,
              },
              Date.now(),
            );

            if (retryAttemptRef.current >= STREAM_RETRY_LIMIT) {
              const recoveryText =
                'Streaming stalled after repeated retries. Please resume from the last successful step and continue.';
              if (autoRecoveryAttemptsRef.current < AUTO_RECOVERY_MAX_ATTEMPTS) {
                autoRecoveryAttemptsRef.current += 1;
                pendingAutoRecoveryRef.current = {
                  promptId,
                  query: [{ text: recoveryText }],
                  timestamp: Date.now(),
                };
                addItem(
                  {
                    type: MessageType.INFO,
                    text: 'Attempting self-recovery after repeated streaming stalls...',
                  },
                  Date.now(),
                );
                return StreamProcessingStatus.RetryLimitExceeded;
              }

              addItem(
                {
                  type: MessageType.ERROR,
                  text: 'Streaming stalled repeatedly and automatic recovery has already been attempted. Stopping response.',
                },
                Date.now(),
              );
              return StreamProcessingStatus.Error;
            }
            break;
          default: {
            // enforces exhaustive switch-case
            const unreachable: never = event;
            return unreachable;
          }
        }
      }
      if (toolCallRequests.length > 0) {
        scheduleToolCalls(toolCallRequests, signal);
      }
      return StreamProcessingStatus.Completed;
    },
    [
      handleContentEvent,
      handleUserCancelledEvent,
      handleErrorEvent,
      scheduleToolCalls,
      handleChatCompressionEvent,
      handleFinishedEvent,
      handleMaxSessionTurnsEvent,
      handleSessionTokenLimitExceededEvent,
      handleTurnBudgetExceededEvent,
      addItem,
      pendingHistoryItemRef,
      setPendingHistoryItem,
      setThought,
    ],
  );

  const submitQuery = useCallback(
    async (
      query: PartListUnion,
      options?: SubmitQueryOptions,
      prompt_id?: string,
    ) => {
      // Prevent concurrent executions of submitQuery, but allow continuations
      // which are part of the same logical flow (tool responses)
      if (isSubmittingQueryRef.current && !options?.isContinuation) {
        return;
      }

      if (
        (streamingState === StreamingState.Responding ||
          streamingState === StreamingState.WaitingForConfirmation) &&
        !options?.isContinuation
      )
        return;

      // Set the flag to indicate we're now executing
      isSubmittingQueryRef.current = true;

      const userMessageTimestamp = Date.now();

      // Reset quota error flag when starting a new query (not a continuation)
      if (!options?.isContinuation) {
        setModelSwitchedFromQuotaError(false);
        config.setQuotaErrorOccurred(false);
      }

      abortControllerRef.current = new AbortController();
      const abortSignal = abortControllerRef.current.signal;
      turnCancelledRef.current = false;

      if (!prompt_id) {
        prompt_id = config.getSessionId() + '########' + getPromptCount();
      }

      const { queryToSend, shouldProceed } = await prepareQueryForGemini(
        query,
        userMessageTimestamp,
        abortSignal,
        prompt_id!,
      );

      if (!shouldProceed || queryToSend === null) {
        isSubmittingQueryRef.current = false;
        return;
      }

      // Handle vision switch requirement
      const visionSwitchResult = await handleVisionSwitch(
        queryToSend,
        userMessageTimestamp,
        options?.isContinuation || false,
      );

      if (!visionSwitchResult.shouldProceed) {
        isSubmittingQueryRef.current = false;
        return;
      }

      const finalQueryToSend = queryToSend;

      if (!options?.isContinuation) {
        retryAttemptRef.current = 0;
        autoRecoveryAttemptsRef.current = 0;
        if (!options?.skipLoopRecoveryReset) {
          loopRecoveryAttemptsRef.current = 0;
        }
        if (!options?.skipProviderRecoveryReset) {
          providerFailureRecoveryAttemptsRef.current = 0;
        }
        if (!options?.skipLimitRecoveryReset) {
          limitRecoveryAttemptsRef.current = 0;
        }
        if (!options?.skipFinishRecoveryReset) {
          finishRecoveryAttemptsRef.current = 0;
        }
        pendingAutoRecoveryRef.current = null;
        startNewPrompt();
        setThought(null); // Reset thought when starting a new prompt
      }

      setIsResponding(true);
      setInitError(null);

      try {
        retryAttemptRef.current = 0;
        const stream = geminiClient.sendMessageStream(
          finalQueryToSend,
          abortSignal,
          prompt_id!,
        );
        const processingStatus = await processGeminiStreamEvents(
          stream,
          userMessageTimestamp,
          abortSignal,
          prompt_id!,
        );

        if (processingStatus === StreamProcessingStatus.UserCancelled) {
          // Restore original model if it was temporarily overridden
          restoreOriginalModel();
          isSubmittingQueryRef.current = false;
          return;
        }

        if (processingStatus === StreamProcessingStatus.RetryLimitExceeded) {
          // self-recovery will be triggered after cleanup below
        }

        if (pendingHistoryItemRef.current) {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
          setPendingHistoryItem(null);
        }
        if (loopDetectedRef.current) {
          loopDetectedRef.current = false;
          if (prompt_id) {
            handleLoopDetectedEvent(prompt_id);
          }
        }

        // Restore original model if it was temporarily overridden
        restoreOriginalModel();
      } catch (error: unknown) {
        // Restore original model if it was temporarily overridden
        restoreOriginalModel();

        if (error instanceof UnauthorizedError) {
          onAuthError();
        } else if (isRetryExhaustedProviderError(error) && prompt_id) {
          await handleProviderFailureRecovery(
            error,
            prompt_id,
            userMessageTimestamp,
          );
        } else if (!isNodeError(error) || error.name !== 'AbortError') {
          addItem(
            {
              type: MessageType.ERROR,
              text: parseAndFormatApiError(
                getErrorMessage(error) || 'Unknown error',
                config.getContentGeneratorConfig()?.authType,
                undefined,
                config.getModel(),
                DEFAULT_GEMINI_FLASH_MODEL,
              ),
            },
            userMessageTimestamp,
          );
        }
      } finally {
        setIsResponding(false);
        isSubmittingQueryRef.current = false;
        const pendingRecovery = pendingAutoRecoveryRef.current;
        if (pendingRecovery) {
          pendingAutoRecoveryRef.current = null;
          queueMicrotask(() => {
            const continuationFlag =
              pendingRecovery.isContinuation ?? true;
            const skipLoopRecoveryReset =
              pendingRecovery.skipLoopReset ?? false;
            const skipProviderRecoveryReset =
              pendingRecovery.skipProviderReset ?? false;
            const skipLimitRecoveryReset =
              pendingRecovery.skipLimitReset ?? false;
            const skipFinishRecoveryReset =
              pendingRecovery.skipFinishReset ?? false;
            void submitQuery(
              pendingRecovery.query,
              {
                isContinuation: continuationFlag,
                skipLoopRecoveryReset,
                skipProviderRecoveryReset,
                skipLimitRecoveryReset,
                skipFinishRecoveryReset,
              },
              pendingRecovery.promptId,
            );
          });
        }
      }
    },
    [
      streamingState,
      setModelSwitchedFromQuotaError,
      prepareQueryForGemini,
      processGeminiStreamEvents,
      pendingHistoryItemRef,
      addItem,
      setPendingHistoryItem,
      setInitError,
      geminiClient,
      onAuthError,
      config,
      startNewPrompt,
      getPromptCount,
      handleLoopDetectedEvent,
      handleVisionSwitch,
      restoreOriginalModel,
      handleProviderFailureRecovery,
    ],
  );

  const handleCompletedTools = useCallback(
    async (completedToolCallsFromScheduler: TrackedToolCall[]) => {
      if (isResponding) {
        return;
      }

      const completedAndReadyToSubmitTools =
        completedToolCallsFromScheduler.filter(
          (
            tc: TrackedToolCall,
          ): tc is TrackedCompletedToolCall | TrackedCancelledToolCall => {
            const isTerminalState =
              tc.status === 'success' ||
              tc.status === 'error' ||
              tc.status === 'cancelled';

            if (isTerminalState) {
              const completedOrCancelledCall = tc as
                | TrackedCompletedToolCall
                | TrackedCancelledToolCall;
              return (
                completedOrCancelledCall.response?.responseParts !== undefined
              );
            }
            return false;
          },
        );

      // Finalize any client-initiated tools as soon as they are done.
      const clientTools = completedAndReadyToSubmitTools.filter(
        (t) => t.request.isClientInitiated,
      );
      if (clientTools.length > 0) {
        markToolsAsSubmitted(clientTools.map((t) => t.request.callId));
      }

      // Identify new, successful save_memory calls that we haven't processed yet.
      const newSuccessfulMemorySaves = completedAndReadyToSubmitTools.filter(
        (t) =>
          t.request.name === 'save_memory' &&
          t.status === 'success' &&
          !processedMemoryToolsRef.current.has(t.request.callId),
      );

      if (newSuccessfulMemorySaves.length > 0) {
        // Perform the refresh only if there are new ones.
        void performMemoryRefresh();
        // Mark them as processed so we don't do this again on the next render.
        newSuccessfulMemorySaves.forEach((t) =>
          processedMemoryToolsRef.current.add(t.request.callId),
        );
      }

      const geminiTools = completedAndReadyToSubmitTools.filter(
        (t) => !t.request.isClientInitiated,
      );

      if (geminiTools.length === 0) {
        return;
      }

      // If all the tools were cancelled, don't submit a response to Gemini.
      const allToolsCancelled = geminiTools.every(
        (tc) => tc.status === 'cancelled',
      );

      if (allToolsCancelled) {
        if (geminiClient) {
          // We need to manually add the function responses to the history
          // so the model knows the tools were cancelled.
          const combinedParts = geminiTools.flatMap(
            (toolCall) => toolCall.response.responseParts,
          );
          geminiClient.addHistory({
            role: 'user',
            parts: combinedParts,
          });
        }

        const callIdsToMarkAsSubmitted = geminiTools.map(
          (toolCall) => toolCall.request.callId,
        );
        markToolsAsSubmitted(callIdsToMarkAsSubmitted);
        return;
      }

      const responsesToSend: Part[] = geminiTools.flatMap(
        (toolCall) => toolCall.response.responseParts,
      );
      const callIdsToMarkAsSubmitted = geminiTools.map(
        (toolCall) => toolCall.request.callId,
      );

      const prompt_ids = geminiTools.map(
        (toolCall) => toolCall.request.prompt_id,
      );

      markToolsAsSubmitted(callIdsToMarkAsSubmitted);

      // Don't continue if model was switched due to quota error
      if (modelSwitchedFromQuotaError) {
        return;
      }

      submitQuery(
        responsesToSend,
        {
          isContinuation: true,
        },
        prompt_ids[0],
      );
    },
    [
      isResponding,
      submitQuery,
      markToolsAsSubmitted,
      geminiClient,
      performMemoryRefresh,
      modelSwitchedFromQuotaError,
    ],
  );

  const pendingHistoryItems = useMemo(
    () =>
      [pendingHistoryItemRef.current, pendingToolCallGroupDisplay].filter(
        (i) => i !== undefined && i !== null,
      ),
    [pendingHistoryItemRef, pendingToolCallGroupDisplay],
  );

  useEffect(() => {
    const saveRestorableToolCalls = async () => {
      if (!config.getCheckpointingEnabled()) {
        return;
      }
      const restorableToolCalls = toolCalls.filter(
        (toolCall) =>
          (toolCall.request.name === 'edit' ||
            toolCall.request.name === 'write_file') &&
          toolCall.status === 'awaiting_approval',
      );

      if (restorableToolCalls.length > 0) {
        const checkpointDir = storage.getProjectTempCheckpointsDir();

        if (!checkpointDir) {
          return;
        }

        try {
          await fs.mkdir(checkpointDir, { recursive: true });
        } catch (error) {
          if (!isNodeError(error) || error.code !== 'EEXIST') {
            onDebugMessage(
              `Failed to create checkpoint directory: ${getErrorMessage(error)}`,
            );
            return;
          }
        }

        for (const toolCall of restorableToolCalls) {
          const filePath = toolCall.request.args['file_path'] as string;
          if (!filePath) {
            onDebugMessage(
              `Skipping restorable tool call due to missing file_path: ${toolCall.request.name}`,
            );
            continue;
          }

          try {
            if (!gitService) {
              onDebugMessage(
                `Checkpointing is enabled but Git service is not available. Failed to create snapshot for ${filePath}. Ensure Git is installed and working properly.`,
              );
              continue;
            }

            let commitHash: string | undefined;
            try {
              commitHash = await gitService.createFileSnapshot(
                `Snapshot for ${toolCall.request.name}`,
              );
            } catch (error) {
              onDebugMessage(
                `Failed to create new snapshot: ${getErrorMessage(error)}. Attempting to use current commit.`,
              );
            }

            if (!commitHash) {
              commitHash = await gitService.getCurrentCommitHash();
            }

            if (!commitHash) {
              onDebugMessage(
                `Failed to create snapshot for ${filePath}. Checkpointing may not be working properly. Ensure Git is installed and the project directory is accessible.`,
              );
              continue;
            }

            const timestamp = new Date()
              .toISOString()
              .replace(/:/g, '-')
              .replace(/\./g, '_');
            const toolName = toolCall.request.name;
            const fileName = path.basename(filePath);
            const toolCallWithSnapshotFileName = `${timestamp}-${fileName}-${toolName}.json`;
            const clientHistory = await geminiClient?.getHistory();
            const toolCallWithSnapshotFilePath = path.join(
              checkpointDir,
              toolCallWithSnapshotFileName,
            );

            await fs.writeFile(
              toolCallWithSnapshotFilePath,
              JSON.stringify(
                {
                  history,
                  clientHistory,
                  toolCall: {
                    name: toolCall.request.name,
                    args: toolCall.request.args,
                  },
                  commitHash,
                  filePath,
                },
                null,
                2,
              ),
            );
          } catch (error) {
            onDebugMessage(
              `Failed to create checkpoint for ${filePath}: ${getErrorMessage(
                error,
              )}. This may indicate a problem with Git or file system permissions.`,
            );
          }
        }
      }
    };
    saveRestorableToolCalls();
  }, [
    toolCalls,
    config,
    onDebugMessage,
    gitService,
    history,
    geminiClient,
    storage,
  ]);

  return {
    streamingState,
    submitQuery,
    initError,
    pendingHistoryItems,
    thought,
    cancelOngoingRequest,
  };
};
function isRetryExhaustedProviderError(
  error: unknown,
): error is RetryExhaustedErrorLike {
  if (error instanceof RetryExhaustedError) {
    return true;
  }
  if (typeof error === 'object' && error !== null) {
    const maybe = error as {
      attempts?: unknown;
      errorCodes?: unknown;
    };
    return (
      typeof maybe.attempts === 'number' &&
      Array.isArray(maybe.errorCodes)
    );
  }
  return false;
}
