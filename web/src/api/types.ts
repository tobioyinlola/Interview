import type { components } from "./schema";

export type Me = components["schemas"]["MeOut"];
export type Notes = components["schemas"]["NotesOut"];
export type NotesInput = components["schemas"]["NotesIn"];

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
