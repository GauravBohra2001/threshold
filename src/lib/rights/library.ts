import rights from "./library.json";

export type RightEntry = {
  id: string;
  plain_statement: string;
  applies_when: string;
  source_url: string;
};

export const rightsLibrary: RightEntry[] = rights as RightEntry[];
