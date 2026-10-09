// Tipos manuales que reflejan supabase/schema.sql.
// Si prefieres tipos generados automáticamente, puedes sustituir este
// archivo por el resultado de `supabase gen types typescript`.

export type Role = "admin" | "director" | "developer" | "comercial";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  director: "Director de proyecto",
  developer: "Developer",
  comercial: "Comercial",
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
  /** Color del avatar (#RRGGBB); null = automático según el id. */
  color: string | null;
  created_at: string;
  added_by: string | null;
}

export type ClientStatus = "lead" | "prospect" | "client" | "former";

export interface ClientContact {
  name: string;
  role: string;
  email: string;
  phone: string;
}

export interface Client {
  id: string;
  name: string;
  status: ClientStatus;
  contacts: ClientContact[];
  // Sin uso desde que hay varios contactos (contacts); se conservan los datos.
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
  | "demo_link" // histórico: antes de que existieran los enlaces del proyecto
  | "link_added"
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

// ---------------------------------------------------------------------------
// Sección Comercial: empresas del embudo, antes de ser proyecto. Sin datos
// económicos a propósito.
// ---------------------------------------------------------------------------
export type ProspectStatus =
  | "sin_contactar"
  | "contactada"
  | "reunion_hecha"
  | "propuesta_enviada"
  | "cerrada"
  | "descartada";
export type ProspectZone = "rodalies" | "alejados";
export type ProspectSource = "ana" | "silleda" | "pipeline" | "propio";

export interface Prospect {
  id: string;
  name: string;
  zone: ProspectZone | null;
  city: string;
  province: string;
  phone: string;
  mobile: string;
  email: string;
  app_code: string | null;
  source: ProspectSource;
  status: ProspectStatus;
  owner_id: string | null;
  next_action: string;
  next_action_date: string | null;
  client_id: string | null;
  project_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_touched_at: string;
}

export interface ProspectEvent {
  id: string;
  prospect_id: string;
  actor_id: string | null;
  kind: "note" | "created" | "status" | "owner" | "next_action";
  text: string;
  data: Record<string, unknown>;
  created_at: string;
  edited_at: string | null;
}

// Enlaces importantes de un proyecto. Solo enlaces, nunca credenciales.
export type LinkCategory = "produccion" | "infraestructura" | "repositorio" | "documentos" | "cliente";

export interface ProjectLink {
  id: string;
  project_id: string;
  label: string;
  url: string;
  category: LinkCategory;
  /** El enlace rápido del proyecto (botón de la cabecera, tarjetas y tabla). */
  featured: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
