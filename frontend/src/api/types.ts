import type { components } from "./schema";

export type Me = components["schemas"]["MeOut"];
export type Notes = components["schemas"]["NotesOut"];
export type NotesInput = components["schemas"]["NotesIn"];
export type CvUpload = components["schemas"]["CvUploadOut"];

type S = components["schemas"];
export type CompanyInput = S["CompanyIn"];
export type Company = S["CompanyOut"];
export type CompanySummary = S["CompanySummary"];
export type CompanyDetail = S["CompanyDetailOut"];
export type CompanyCreated = S["CompanyCreatedOut"];
export type ResearchJob = S["JobOut"];
export type Source = S["SourceOut"];
export type Brief = S["BriefContent"];
export type BriefSection = S["BriefSection"];
export type BriefFact = S["BriefFact"];
export type SessionCreated = S["SessionCreateOut"];
export type SessionDetail = S["SessionDetailOut"];
export type Utterance = S["UtteranceOut"];
export type SuggestionRecord = S["SuggestionOut"];
export type SessionSummary = S["SessionSummary"];
export type SessionList = S["SessionListOut"];
export type Score = S["ScoreOut"];
export type Gap = S["GapOut"];
/** One change sent to the brief: no id adds a fact; an id updates, pins or deletes it. (Written by
 *  hand: the generated type marks fields that have server defaults as required.) */
export interface BriefEdit {
  id?: string | null;
  section_key: string;
  text?: string;
  pinned?: boolean;
  delete?: boolean;
}
export type BriefEditResult = S["BriefEditOut"];
export type UsageSummary = S["UsageSummary"];
export type UsageDay = S["UsageDay"];
