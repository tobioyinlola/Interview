import type { components } from "./schema";

export type Me = components["schemas"]["MeOut"];
export type Billing = components["schemas"]["BillingOut"];
export type Notes = components["schemas"]["NotesOut"];
export type NotesInput = components["schemas"]["NotesIn"];
export type CvUpload = components["schemas"]["CvUploadOut"];
export type OnboardingInput = components["schemas"]["OnboardingIn"];

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

export type AdminOverview = S["OverviewOut"];
export type AdminUserRow = S["UserRow"];
export type AdminUserList = S["UserListOut"];
export type AdminUserDetail = S["UserDetailOut"];
export type AdminActivity = S["ActivityOut"];
export type AdminReferrals = S["ReferralsOut"];
export type AdminMarketing = S["MarketingOut"];
export type AdminQuality = S["QualityOut"];
export type AdminEmails = S["EmailsOut"];
export type AdminTemplate = S["TemplateInfo"];
export type AdminTemplatePreview = S["TemplatePreview"];

// Auto-Apply
export type AAProfile = S["ProfileOut"];
export type AAProfileIn = S["SearchProfileIn"];
export type AAFacts = S["FactsOut"];
export type AAAnswer = S["AnswerOut"];
export type AADisclosure = S["Disclosure"];
export type AACampaign = S["CampaignOut"];
export type AADashboard = S["DashboardOut"];
export type AAApplication = S["ApplicationOut"];
export type AAApplicationDetail = S["ApplicationDetail"];
export type AAApplicationPage = S["ApplicationPage"];
export type AAInterview = S["InterviewOut"];
export type AARecruiting = S["RecruitingOut"];
export type AAMailbox = S["MailboxOut"];
export type AAMailboxCheck = S["MailboxCheckOut"];
export type AARun = S["RunOut"];
export type AAOutreach = S["OutreachOut"];
export type AAPrepared = S["PrepareOut"];
export type AdminAutoApply = S["AutoApplyAdminOut"];
export type AdminSwitch = S["SwitchOut"];
