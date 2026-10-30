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
  CountrySubstitutionSchema,
  SearchCoverageSchema,
  SearchMetaSchema,
  CandidateTableSchema,
  PriceHintSchema,
  SearchCandidateSchema,
  CandidateListMetaSchema,
  CandidateListSchema,
} from "./search.ts";
export type {
  NormalizedCandidate,
  Candidate,
  CountrySubstitution,
  SearchCoverage,
  SearchMeta,
  CandidateTable,
  PriceHint,
  SearchCandidate,
  CandidateListMeta,
  CandidateList,
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
  isRankableMatch,
  missingInfo,
  countQualified,
  rankVerified,
} from "./ranking.ts";
export type { OfferClass } from "./ranking.ts";
