export interface AIModelOption {
  id: string;
  label: string;
  providerLabel: string;
  modelId: string;
  isDefault: boolean;
  supportsMultimodal: boolean;
}

export type AIModelId = string;
