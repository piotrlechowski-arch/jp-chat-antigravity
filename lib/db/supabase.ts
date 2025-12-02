import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "Supabase credentials missing. Make sure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set."
  );
}

export const supabase = createClient(supabaseUrl || '', supabaseKey || '', {
  db: {
    schema: 'chat',
  },
});

export type User = {
  id: string;
  auth_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Conversation = {
  id: string;
  user_id: string;
  thread_id: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

export type UserMemory = {
  id: string;
  user_id: string;
  memory_type: string | null;
  content: string;
  importance: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};
