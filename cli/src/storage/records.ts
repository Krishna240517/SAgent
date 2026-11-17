export type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  created_at: string;
};

export type ProjectLink = {
  project_id: string;
  local_path: string;
  remote_url: string | null;
  created_at: string;
};

export type Decision = {
  id: string;
  content: string;
  source_message_id: string | null;
  created_at: string;
};

export type Task = {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  created_at: string;
  updated_at: string;
};

export type OutboxEntry = {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: "upsert" | "delete";
  payload_json: string;
  created_at: string;
};

export type Summary = {
  id: string;
  conversation_id: string;
  content: string;
  source_message_ids_json: string;
  created_at: string;
};

export type AcceptedPreference = {
  id: string;
  content: string;
  source: "user" | "message";
  source_message_id: string | null;
  approved_at: string;
};
