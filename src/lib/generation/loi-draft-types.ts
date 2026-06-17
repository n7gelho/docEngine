import type { DealParameterKey } from "@/lib/extraction/deal-parameters";

import type { ProformaBrief } from "@/lib/retrieval/proforma-brief";



export type DraftFieldSource =

  | "proforma"

  | "precedent"

  | "precedent+proforma"

  | "template"

  | "user";



export type LoiDraftField = {

  key: string;

  label: string;

  value: string | null;

  source: DraftFieldSource;

  precedentDocumentId?: string | null;

  precedentFilename?: string | null;

  fieldScore?: number | null;

  briefKeys?: DealParameterKey[];

  editable: boolean;

};



export type LoiDraftSection = {

  id: string;

  title: string;

  fields: LoiDraftField[];

};



export type LoiDraftContent = {

  documentTitle: string;

  /** ID of the precedent used to derive template structure. */

  templateDocumentId?: string | null;

  templateFilename?: string | null;

  sections: LoiDraftSection[];

};



export type AssemblyLogStep = {

  step: string;

  detail: string;

};



export type LoiTemplateFieldDef = {

  key: string;

  label: string;

  briefKey?: DealParameterKey;

  defaultValue?: string;

};



export type LoiTemplateSectionDef = {

  id: string;

  title: string;

  fields: LoiTemplateFieldDef[];

};



export type AssembleLoiDraftInput = {

  brief: ProformaBrief;

  precedentDocumentIds: string[];

  projectTitle?: string;

  templateOnly?: boolean;

  /** Whole-document match scores from precedent search (documentId → score). */

  precedentMatchScores?: Record<string, number>;

};



export type AssembleLoiDraftResult = {

  content: LoiDraftContent;

  assemblyLog: AssemblyLogStep[];

  completenessPct: number;

  filledCount: number;

  totalCount: number;

};


