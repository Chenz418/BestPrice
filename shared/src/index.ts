export {
  SearchQuerySchema,
  QuerySchema,
  ConfidenceSchema,
  RepresentativeImageSchema,
  ProductCardSchema,
} from "./identify.ts";
export type {
  SearchQuery,
  Query,
  Confidence,
  RepresentativeImage,
  ProductCard,
} from "./identify.ts";

export {
  NormalizedCandidateSchema,
  CandidateSchema,
  SearchMetaSchema,
  CandidateTableSchema,
} from "./search.ts";
export type {
  NormalizedCandidate,
  Candidate,
  SearchMeta,
  CandidateTable,
} from "./search.ts";

export {
  SnapshotOutcomeSchema,
  PageSnapshotSchema,
  PromotionSchema,
  VerifiedFactsSchema,
  RankedOfferSchema,
  RankedResultsSchema,
} from "./verify.ts";
export type {
  SnapshotOutcome,
  PageSnapshot,
  Promotion,
  VerifiedFacts,
  RankedOffer,
  RankedResults,
} from "./verify.ts";

export {
  effectiveShippingEur,
  guaranteedTotalEur,
  classifyOffer,
  countQualified,
  rankVerified,
} from "./ranking.ts";
export type { OfferClass } from "./ranking.ts";
