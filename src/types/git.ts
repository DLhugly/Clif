export interface GitFileStatus {
  path: string;
  status: string;
  staged: boolean;
}

export interface GitBranch {
  name: string;
  is_current: boolean;
}

export interface GitFileNumstat {
  path: string;
  insertions: number;
  deletions: number;
}

export interface GitLogEntry {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  date: string;
  refs: string[];
  is_head: boolean;
  parents: string[];
}
