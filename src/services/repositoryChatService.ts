/**
 * 门面：仓库问答服务的实现已按职责拆分到 chat/，这里保持原有公开符号
 * 与导入路径不变，现有调用方（agentToolLoop、repositoryChatRunner、
 * useRepositoryChatSessions 等）无需改动。
 */
export {
  ANSWER_FORMAT_DIRECTIVE,
  ANSWER_LENGTH_DIRECTIVE,
  buildEvidenceGatePrompt,
  buildQueryUnderstandingPrompt,
  buildRetrievalPlanPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from './chat/prompts';
export {
  noVerifiedSummaryResponse,
  pruneUnverifiableSections,
  sourceBoundEvidenceDigest,
  untrustedEvidenceBlock,
} from './chat/citations';
export {
  MARKDOWN_EVIDENCE_PATH,
  asStringArray,
  buildEvidenceWindows,
  citableSegmentsForDocument,
  detectResearchFocus,
  documentationCandidatesFrom,
  evidenceFromSegments,
  evidenceSearchTerms,
  isRepositoryCodePath,
  linkedDocumentationPaths,
  makeEvidence,
  makeMarkdownHeadings,
  normalizePath,
  parseJsonObject,
  rankedCandidatePaths,
  resolveRepositoryChatHeadSha,
  sectionSegments,
  splitOwnerAndRepo,
} from './chat/retrieval';
export {
  createEvidenceToolbox,
  evidenceAgentInsufficientResponse,
  isTransientAgentError,
  resolveTurnLimits,
  runEvidenceDrivenRepositoryChatTurn,
  synthesizeVerifiedAnswer,
} from './chat/loop';
export type { CachedDocument, TreeEntry } from './chat/retrieval';
export type {
  ChatToolEventInput,
  RepositoryChatTurnInput,
  RepositoryChatTurnResult,
} from './chat/loop';
