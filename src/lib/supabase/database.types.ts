export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      characters: {
        Row: {
          based_on_real_person: boolean
          client_id: string
          consent_confirmed: boolean
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          role: string | null
          sheet_asset_ids: string[]
          updated_at: string
          visual_notes: string | null
        }
        Insert: {
          based_on_real_person?: boolean
          client_id: string
          consent_confirmed?: boolean
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          role?: string | null
          sheet_asset_ids?: string[]
          updated_at?: string
          visual_notes?: string | null
        }
        Update: {
          based_on_real_person?: boolean
          client_id?: string
          consent_confirmed?: boolean
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          role?: string | null
          sheet_asset_ids?: string[]
          updated_at?: string
          visual_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "characters_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          notes: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          notes?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      clips: {
        Row: {
          created_at: string
          deleted_at: string | null
          duration_sec: number | null
          engine: string | null
          frame_id: string | null
          id: string
          selected: boolean
          shot_id: string
          updated_at: string
          video_path: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          duration_sec?: number | null
          engine?: string | null
          frame_id?: string | null
          id?: string
          selected?: boolean
          shot_id: string
          updated_at?: string
          video_path?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          duration_sec?: number | null
          engine?: string | null
          frame_id?: string | null
          id?: string
          selected?: boolean
          shot_id?: string
          updated_at?: string
          video_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clips_frame_id_fkey"
            columns: ["frame_id"]
            isOneToOne: false
            referencedRelation: "frames"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clips_shot_id_fkey"
            columns: ["shot_id"]
            isOneToOne: false
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
        ]
      }
      engine_calls: {
        Row: {
          cost_usd: number
          created_at: string
          deleted_at: string | null
          duration_ms: number
          engine: string
          error: string | null
          id: string
          image_count: number | null
          input_tokens: number | null
          job_id: string | null
          model: string
          operation: string
          output_tokens: number | null
          project_id: string | null
          updated_at: string
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          deleted_at?: string | null
          duration_ms: number
          engine: string
          error?: string | null
          id?: string
          image_count?: number | null
          input_tokens?: number | null
          job_id?: string | null
          model: string
          operation: string
          output_tokens?: number | null
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          deleted_at?: string | null
          duration_ms?: number
          engine?: string
          error?: string | null
          id?: string
          image_count?: number | null
          input_tokens?: number | null
          job_id?: string | null
          model?: string
          operation?: string
          output_tokens?: number | null
          project_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engine_calls_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engine_calls_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_costs"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engine_calls_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      frames: {
        Row: {
          cost_usd: number
          created_at: string
          deleted_at: string | null
          engine: string
          id: string
          job_id: string | null
          model: string
          negative_used: string | null
          prompt_used: string
          reference_asset_ids: string[]
          rejected: boolean
          review_notes: string | null
          selected: boolean
          shot_id: string
          storage_path: string
          updated_at: string
          variant_index: number
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          deleted_at?: string | null
          engine: string
          id?: string
          job_id?: string | null
          model: string
          negative_used?: string | null
          prompt_used: string
          reference_asset_ids?: string[]
          rejected?: boolean
          review_notes?: string | null
          selected?: boolean
          shot_id: string
          storage_path: string
          updated_at?: string
          variant_index: number
        }
        Update: {
          cost_usd?: number
          created_at?: string
          deleted_at?: string | null
          engine?: string
          id?: string
          job_id?: string | null
          model?: string
          negative_used?: string | null
          prompt_used?: string
          reference_asset_ids?: string[]
          rejected?: boolean
          review_notes?: string | null
          selected?: boolean
          shot_id?: string
          storage_path?: string
          updated_at?: string
          variant_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "frames_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "frames_shot_id_fkey"
            columns: ["shot_id"]
            isOneToOne: false
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          cost_usd: number
          created_at: string
          deleted_at: string | null
          error: string | null
          finished_at: string | null
          heartbeat_at: string | null
          id: string
          payload: Json
          progress: Json | null
          project_id: string
          result: Json | null
          shot_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          type: Database["public"]["Enums"]["job_type"]
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          cost_usd?: number
          created_at?: string
          deleted_at?: string | null
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          payload?: Json
          progress?: Json | null
          project_id: string
          result?: Json | null
          shot_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          type: Database["public"]["Enums"]["job_type"]
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          cost_usd?: number
          created_at?: string
          deleted_at?: string | null
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          payload?: Json
          progress?: Json | null
          project_id?: string
          result?: Json | null
          shot_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          type?: Database["public"]["Enums"]["job_type"]
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_costs"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_shot_id_fkey"
            columns: ["shot_id"]
            isOneToOne: false
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
        ]
      }
      library_assets: {
        Row: {
          client_id: string
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["asset_kind"]
          lineage_id: string
          mime_type: string | null
          storage_path: string | null
          text_content: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          client_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["asset_kind"]
          lineage_id?: string
          mime_type?: string | null
          storage_path?: string | null
          text_content?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["asset_kind"]
          lineage_id?: string
          mime_type?: string | null
          storage_path?: string | null
          text_content?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "library_assets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          client_id: string
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          name: string
          plate_asset_ids: string[]
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name: string
          plate_asset_ids?: string[]
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          name?: string
          plate_asset_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          aspect_ratio: string
          client_id: string
          created_at: string
          deleted_at: string | null
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["project_status"]
          target_duration_sec: number | null
          title: string
          updated_at: string
        }
        Insert: {
          aspect_ratio?: string
          client_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_duration_sec?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          aspect_ratio?: string
          client_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          target_duration_sec?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      scripts: {
        Row: {
          approved_at: string | null
          content: string
          created_at: string
          deleted_at: string | null
          generation_params: Json
          id: string
          project_id: string
          status: Database["public"]["Enums"]["script_status"]
          updated_at: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          content?: string
          created_at?: string
          deleted_at?: string | null
          generation_params?: Json
          id?: string
          project_id: string
          status?: Database["public"]["Enums"]["script_status"]
          updated_at?: string
          version: number
        }
        Update: {
          approved_at?: string | null
          content?: string
          created_at?: string
          deleted_at?: string | null
          generation_params?: Json
          id?: string
          project_id?: string
          status?: Database["public"]["Enums"]["script_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "scripts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_costs"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "scripts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      shots: {
        Row: {
          action: string | null
          character_ids: string[]
          created_at: string
          deleted_at: string | null
          est_duration_sec: number | null
          framing: Database["public"]["Enums"]["shot_framing"]
          id: string
          image_negative: string | null
          image_prompt: string | null
          lighting: string | null
          location_id: string | null
          notes: string | null
          on_screen_text: string | null
          order_index: number
          project_id: string
          prompt_inputs_hash: string | null
          prompts_generated_at: string | null
          scene_number: number
          scene_title: string | null
          script_version: number
          status: Database["public"]["Enums"]["shot_status"]
          updated_at: string
          video_prompt: string | null
          vo_line: string | null
        }
        Insert: {
          action?: string | null
          character_ids?: string[]
          created_at?: string
          deleted_at?: string | null
          est_duration_sec?: number | null
          framing?: Database["public"]["Enums"]["shot_framing"]
          id?: string
          image_negative?: string | null
          image_prompt?: string | null
          lighting?: string | null
          location_id?: string | null
          notes?: string | null
          on_screen_text?: string | null
          order_index: number
          project_id: string
          prompt_inputs_hash?: string | null
          prompts_generated_at?: string | null
          scene_number: number
          scene_title?: string | null
          script_version: number
          status?: Database["public"]["Enums"]["shot_status"]
          updated_at?: string
          video_prompt?: string | null
          vo_line?: string | null
        }
        Update: {
          action?: string | null
          character_ids?: string[]
          created_at?: string
          deleted_at?: string | null
          est_duration_sec?: number | null
          framing?: Database["public"]["Enums"]["shot_framing"]
          id?: string
          image_negative?: string | null
          image_prompt?: string | null
          lighting?: string | null
          location_id?: string | null
          notes?: string | null
          on_screen_text?: string | null
          order_index?: number
          project_id?: string
          prompt_inputs_hash?: string | null
          prompts_generated_at?: string | null
          scene_number?: number
          scene_title?: string | null
          script_version?: number
          status?: Database["public"]["Enums"]["shot_status"]
          updated_at?: string
          video_prompt?: string | null
          vo_line?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shots_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_costs"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "shots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          created_at: string
          deleted_at: string | null
          extracted_images: string[]
          extracted_notes: string | null
          extracted_text: string | null
          file_name: string
          id: string
          mime_type: string
          order_index: number
          project_id: string
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          extracted_images?: string[]
          extracted_notes?: string | null
          extracted_text?: string | null
          file_name: string
          id?: string
          mime_type: string
          order_index?: number
          project_id: string
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          extracted_images?: string[]
          extracted_notes?: string | null
          extracted_text?: string | null
          file_name?: string
          id?: string
          mime_type?: string
          order_index?: number
          project_id?: string
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sources_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_costs"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "sources_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      timelines: {
        Row: {
          created_at: string
          data: Json
          deleted_at: string | null
          id: string
          project_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          project_id: string
          updated_at?: string
          version: number
        }
        Update: {
          created_at?: string
          data?: Json
          deleted_at?: string | null
          id?: string
          project_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "timelines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_costs"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "timelines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      voiceovers: {
        Row: {
          audio_path: string | null
          created_at: string
          deleted_at: string | null
          duration_sec: number | null
          id: string
          shot_id: string
          timestamps: Json | null
          updated_at: string
          voice_id: string | null
        }
        Insert: {
          audio_path?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_sec?: number | null
          id?: string
          shot_id: string
          timestamps?: Json | null
          updated_at?: string
          voice_id?: string | null
        }
        Update: {
          audio_path?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_sec?: number | null
          id?: string
          shot_id?: string
          timestamps?: Json | null
          updated_at?: string
          voice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voiceovers_shot_id_fkey"
            columns: ["shot_id"]
            isOneToOne: false
            referencedRelation: "shots"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      project_cost_breakdown: {
        Row: {
          calls: number | null
          cost_usd: number | null
          duration_ms: number | null
          engine: string | null
          errors: number | null
          images: number | null
          last_call_at: string | null
          model: string | null
          operation: string | null
          project_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engine_calls_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_costs"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "engine_calls_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_costs: {
        Row: {
          call_count: number | null
          cost_usd: number | null
          project_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      claim_next_job: {
        Args: { p_worker_id: string }
        Returns: {
          attempts: number
          cost_usd: number
          created_at: string
          deleted_at: string | null
          error: string | null
          finished_at: string | null
          heartbeat_at: string | null
          id: string
          payload: Json
          progress: Json | null
          project_id: string
          result: Json | null
          shot_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          type: Database["public"]["Enums"]["job_type"]
          updated_at: string
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      asset_kind:
        | "style_bible"
        | "script_system_prompt"
        | "image_system_prompt"
        | "video_system_prompt"
        | "negative_prompt"
        | "ppe_sheet"
        | "logo"
        | "character_sheet"
        | "location_plate"
        | "reference_other"
      job_status: "queued" | "running" | "done" | "error"
      job_type:
        | "extract_source"
        | "generate_script"
        | "generate_shotlist"
        | "generate_prompts"
        | "generate_frames"
      project_status: "draft" | "script" | "shotlist" | "frames" | "done"
      script_status: "draft" | "approved"
      shot_framing: "hero" | "wide" | "medium" | "closeup" | "insert" | "group"
      shot_status: "draft" | "approved" | "frame_selected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      asset_kind: [
        "style_bible",
        "script_system_prompt",
        "image_system_prompt",
        "video_system_prompt",
        "negative_prompt",
        "ppe_sheet",
        "logo",
        "character_sheet",
        "location_plate",
        "reference_other",
      ],
      job_status: ["queued", "running", "done", "error"],
      job_type: [
        "extract_source",
        "generate_script",
        "generate_shotlist",
        "generate_prompts",
        "generate_frames",
      ],
      project_status: ["draft", "script", "shotlist", "frames", "done"],
      script_status: ["draft", "approved"],
      shot_framing: ["hero", "wide", "medium", "closeup", "insert", "group"],
      shot_status: ["draft", "approved", "frame_selected"],
    },
  },
} as const

