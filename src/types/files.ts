export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  extension: string | null;
  children: FileEntry[] | null;
}

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  language: string;
  isDirty: boolean;
}
