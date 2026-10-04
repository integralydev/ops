// Tipos manuales que reflejan supabase/schema.sql.
// Si prefieres tipos generados automáticamente, puedes sustituir este
// archivo por el resultado de `supabase gen types typescript`.

export type Role = "admin" | "director" | "developer";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  director: "Director de proyecto",
  developer: "Developer",
};
export type ProjectStatus =
  | "descubrimiento"
  | "propuesta"
  | "presupuesto"
  | "desarrollo"
  | "testing"
  | "mantenimiento"
  | "pausado"
  | "cerrado";

export interface Profile {
  id: string;
  role: Role;
  full_name: string | null;
  created_at: string;
  added_by: string | null;
}

export interface Client {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  client_id: string | null;
  status: ProjectStatus;
  owner_id: string | null;
  developer_ids: string[];
  next_step: string | null;
  description: string | null;
  demo_url: string | null;
  notes_doc: string | null;
  notes_updated_at: string | null;
  notes_updated_by: string | null;
  scope_closed_at: string | null;
  scope_closed_by: string | null;
  scope_source_file_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  assignee_id: string | null;
  assigned_to_client: boolean;
  done: boolean;
  done_at: string | null;
  created_at: string;
  created_by: string | null;
}

export interface FileRow {
  id: string;
  project_id: string;
  storage_path: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
  task_id: string | null;
}

export interface Note {
  id: string;
  project_id: string;
  author_id: string | null;
  text: string;
  image_paths: string[] | null;
  created_at: string;
  edited_at: string | null;
}

export type ScopeStatus = "incluido" | "excluido" | "por_decidir";

// Punto del scope de un proyecto. Sin importes a propósito.
export interface ScopeItem {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: ScopeStatus;
  block: string;
  is_extension: boolean;
  position: number;
  created_at: string;
  created_by: string | null;
}

export type ActivityKind =
  | "project_created"
  | "status_changed"
  | "owner_changed"
  | "developer_added"
  | "demo_link"
  | "notes_edited"
  | "next_step"
  | "task_created"
  | "task_done"
  | "file_uploaded"
  | "update_posted";

// Registro de actividad: lo rellenan triggers de la base de datos
export interface Activity {
  id: string;
  project_id: string;
  actor_id: string | null;
  kind: ActivityKind;
  data: Record<string, unknown>;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile> & { id: string }; Update: Partial<Profile> };
      clients: { Row: Client; Insert: Partial<Client>; Update: Partial<Client> };
      projects: { Row: Project; Insert: Partial<Project>; Update: Partial<Project> };
      tasks: { Row: Task; Insert: Partial<Task>; Update: Partial<Task> };
      files: { Row: FileRow; Insert: Partial<FileRow>; Update: Partial<FileRow> };
      notes: { Row: Note; Insert: Partial<Note>; Update: Partial<Note> };
    };
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      is_project_member: { Args: { pid: string }; Returns: boolean };
      update_next_step: { Args: { pid: string; val: string }; Returns: void };
    };
  };
}
