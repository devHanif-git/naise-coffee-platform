export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      addons: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          name: string
          price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          name: string
          price: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          name?: string
          price?: number
          updated_at?: string
        }
        Relationships: []
      }
      bean_transactions: {
        Row: {
          amount: number
          category: Database["public"]["Enums"]["bean_txn_category"]
          created_at: string
          id: string
          is_reversal: boolean
          label: string
          order_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          category: Database["public"]["Enums"]["bean_txn_category"]
          created_at?: string
          id?: string
          is_reversal?: boolean
          label: string
          order_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          category?: Database["public"]["Enums"]["bean_txn_category"]
          created_at?: string
          id?: string
          is_reversal?: boolean
          label?: string
          order_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bean_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          max_addons: number
          name: string
          recipe: Json | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          max_addons?: number
          name: string
          recipe?: Json | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          max_addons?: number
          name?: string
          recipe?: Json | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      category_addons: {
        Row: {
          addon_id: string
          category_id: string
          sort_order: number
        }
        Insert: {
          addon_id: string
          category_id: string
          sort_order?: number
        }
        Update: {
          addon_id?: string
          category_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "category_addons_addon_id_fkey"
            columns: ["addon_id"]
            isOneToOne: false
            referencedRelation: "addons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_addons_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_items: {
        Row: {
          created_at: string
          id: string
          is_always_included: boolean
          is_archived: boolean
          name: string
          prep_template: string | null
          price: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_always_included?: boolean
          is_archived?: boolean
          name: string
          prep_template?: string | null
          price: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_always_included?: boolean
          is_archived?: boolean
          name?: string
          prep_template?: string | null
          price?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      custom_drinks: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          last_price: number
          last_used_at: string | null
          name: string
          times_used: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_price: number
          last_used_at?: string | null
          name: string
          times_used?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_price?: number
          last_used_at?: string | null
          name?: string
          times_used?: number
          updated_at?: string
        }
        Relationships: []
      }
      loyalty_settings: {
        Row: {
          beans_per_ringgit: number
          created_at: string
          id: boolean
          referral_beans: number
          referral_voucher_label: string
          updated_at: string
        }
        Insert: {
          beans_per_ringgit?: number
          created_at?: string
          id?: boolean
          referral_beans?: number
          referral_voucher_label?: string
          updated_at?: string
        }
        Update: {
          beans_per_ringgit?: number
          created_at?: string
          id?: boolean
          referral_beans?: number
          referral_voucher_label?: string
          updated_at?: string
        }
        Relationships: []
      }
      order_adjustments: {
        Row: {
          created_at: string
          delta: number
          from_label: string
          id: string
          item_position: number
          kind: string
          order_id: string
          to_label: string | null
        }
        Insert: {
          created_at?: string
          delta: number
          from_label: string
          id?: string
          item_position: number
          kind: string
          order_id: string
          to_label?: string | null
        }
        Update: {
          created_at?: string
          delta?: number
          from_label?: string
          id?: string
          item_position?: number
          kind?: string
          order_id?: string
          to_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_adjustments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          addon_names: string[]
          id: string
          is_custom: boolean
          is_reward: boolean
          line_total: number
          name: string
          order_id: string
          position: number
          product_id: string | null
          quantity: number
          reward_cost: number
          size_name: string | null
          status: Database["public"]["Enums"]["item_status"]
          unit_cost: number | null
          unit_original_price: number | null
          unit_price: number
          voided_at: string | null
        }
        Insert: {
          addon_names?: string[]
          id?: string
          is_custom?: boolean
          is_reward?: boolean
          line_total: number
          name: string
          order_id: string
          position: number
          product_id?: string | null
          quantity: number
          reward_cost?: number
          size_name?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          unit_cost?: number | null
          unit_original_price?: number | null
          unit_price: number
          voided_at?: string | null
        }
        Update: {
          addon_names?: string[]
          id?: string
          is_custom?: boolean
          is_reward?: boolean
          line_total?: number
          name?: string
          order_id?: string
          position?: number
          product_id?: string | null
          quantity?: number
          reward_cost?: number
          size_name?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          unit_cost?: number | null
          unit_original_price?: number | null
          unit_price?: number
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          completed_at: string | null
          contact_phone: string | null
          created_at: string
          id: string
          notes: string | null
          order_number: string | null
          order_seq: number
          owner_id: string
          payment_method: string
          proof_of_payment_url: string | null
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          token: string
          total: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          order_number?: string | null
          order_seq?: number
          owner_id: string
          payment_method: string
          proof_of_payment_url?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          subtotal: number
          token?: string
          total: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          order_number?: string | null
          order_seq?: number
          owner_id?: string
          payment_method?: string
          proof_of_payment_url?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          token?: string
          total?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      payment_settings: {
        Row: {
          apple_pay_enabled: boolean
          bank_account_holder: string
          bank_account_number: string
          bank_enabled: boolean
          bank_name: string
          bank_transfer_enabled: boolean
          boost_enabled: boolean
          card_enabled: boolean
          cash_enabled: boolean
          cash_method_enabled: boolean
          created_at: string
          duitnow_qr_enabled: boolean
          duitnow_qr_url: string | null
          ewallet_enabled: boolean
          google_pay_enabled: boolean
          grabpay_enabled: boolean
          id: boolean
          pay_later_enabled: boolean
          qr_enabled: boolean
          tng_ewallet_enabled: boolean
          updated_at: string
        }
        Insert: {
          apple_pay_enabled?: boolean
          bank_account_holder?: string
          bank_account_number?: string
          bank_enabled?: boolean
          bank_name?: string
          bank_transfer_enabled?: boolean
          boost_enabled?: boolean
          card_enabled?: boolean
          cash_enabled?: boolean
          cash_method_enabled?: boolean
          created_at?: string
          duitnow_qr_enabled?: boolean
          duitnow_qr_url?: string | null
          ewallet_enabled?: boolean
          google_pay_enabled?: boolean
          grabpay_enabled?: boolean
          id?: boolean
          pay_later_enabled?: boolean
          qr_enabled?: boolean
          tng_ewallet_enabled?: boolean
          updated_at?: string
        }
        Update: {
          apple_pay_enabled?: boolean
          bank_account_holder?: string
          bank_account_number?: string
          bank_enabled?: boolean
          bank_name?: string
          bank_transfer_enabled?: boolean
          boost_enabled?: boolean
          card_enabled?: boolean
          cash_enabled?: boolean
          cash_method_enabled?: boolean
          created_at?: string
          duitnow_qr_enabled?: boolean
          duitnow_qr_url?: string | null
          ewallet_enabled?: boolean
          google_pay_enabled?: boolean
          grabpay_enabled?: boolean
          id?: boolean
          pay_later_enabled?: boolean
          qr_enabled?: boolean
          tng_ewallet_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      product_addons: {
        Row: {
          addon_id: string
          mode: string
          product_id: string
          sort_order: number
        }
        Insert: {
          addon_id: string
          mode: string
          product_id: string
          sort_order?: number
        }
        Update: {
          addon_id?: string
          mode?: string
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_addons_addon_id_fkey"
            columns: ["addon_id"]
            isOneToOne: false
            referencedRelation: "addons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_addons_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_recipe_items: {
        Row: {
          amount_grams: number | null
          cost_item_id: string
          product_id: string
          sort_order: number
        }
        Insert: {
          amount_grams?: number | null
          cost_item_id: string
          product_id: string
          sort_order?: number
        }
        Update: {
          amount_grams?: number | null
          cost_item_id?: string
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_recipe_items_cost_item_id_fkey"
            columns: ["cost_item_id"]
            isOneToOne: false
            referencedRelation: "cost_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_recipe_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          created_at: string
          id: string
          name: string
          price: number
          product_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          price: number
          product_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          price?: number
          product_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          base_price: number | null
          category_id: string
          created_at: string
          description: string
          id: string
          image_url: string | null
          is_archived: boolean
          is_available: boolean
          is_best_seller: boolean
          is_featured: boolean
          is_new: boolean
          max_addons: number | null
          name: string
          recipe: Json | null
          recipe_steps: string[] | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          base_price?: number | null
          category_id: string
          created_at?: string
          description?: string
          id?: string
          image_url?: string | null
          is_archived?: boolean
          is_available?: boolean
          is_best_seller?: boolean
          is_featured?: boolean
          is_new?: boolean
          max_addons?: number | null
          name: string
          recipe?: Json | null
          recipe_steps?: string[] | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          base_price?: number | null
          category_id?: string
          created_at?: string
          description?: string
          id?: string
          image_url?: string | null
          is_archived?: boolean
          is_available?: boolean
          is_best_seller?: boolean
          is_featured?: boolean
          is_new?: boolean
          max_addons?: number | null
          name?: string
          recipe?: Json | null
          recipe_steps?: string[] | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          welcomed_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          welcomed_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          welcomed_at?: string | null
        }
        Relationships: []
      }
      promotion_categories: {
        Row: {
          category_id: string
          promotion_id: string
        }
        Insert: {
          category_id: string
          promotion_id: string
        }
        Update: {
          category_id?: string
          promotion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_categories_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_products: {
        Row: {
          product_id: string
          promotion_id: string
        }
        Insert: {
          product_id: string
          promotion_id: string
        }
        Update: {
          product_id?: string
          promotion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_products_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          created_at: string
          ends_at: string | null
          id: string
          is_active: boolean
          label: string
          percent_off: number
          slug: string
          sort_order: number
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          label: string
          percent_off: number
          slug: string
          sort_order?: number
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: string
          is_active?: boolean
          label?: string
          percent_off?: number
          slug?: string
          sort_order?: number
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reward_accounts: {
        Row: {
          balance: number
          created_at: string
          current_streak: number
          last_check_in: string | null
          lifetime_earned: number
          longest_streak: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          created_at?: string
          current_streak?: number
          last_check_in?: string | null
          lifetime_earned?: number
          longest_streak?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          created_at?: string
          current_streak?: number
          last_check_in?: string | null
          lifetime_earned?: number
          longest_streak?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reward_catalog: {
        Row: {
          cost: number
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          is_archived: boolean
          name: string
          product_id: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          cost: number
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_archived?: boolean
          name: string
          product_id: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          cost?: number
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_archived?: boolean
          name?: string
          product_id?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_catalog_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_tiers: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          name: string
          perk: string
          slug: string
          sort_order: number
          threshold: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          name: string
          perk: string
          slug: string
          sort_order?: number
          threshold: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          name?: string
          perk?: string
          slug?: string
          sort_order?: number
          threshold?: number
          updated_at?: string
        }
        Relationships: []
      }
      store_account: {
        Row: {
          id: boolean
          is_enabled: boolean
          last_rotated_at: string | null
          store_user_id: string | null
          updated_at: string
        }
        Insert: {
          id?: boolean
          is_enabled?: boolean
          last_rotated_at?: string | null
          store_user_id?: string | null
          updated_at?: string
        }
        Update: {
          id?: boolean
          is_enabled?: boolean
          last_rotated_at?: string | null
          store_user_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      store_settings: {
        Row: {
          closed_message: string
          created_at: string
          id: boolean
          is_open: boolean
          referral_enabled: boolean
          rewards_enabled: boolean
          streak_enabled: boolean
          updated_at: string
        }
        Insert: {
          closed_message?: string
          created_at?: string
          id?: boolean
          is_open?: boolean
          referral_enabled?: boolean
          rewards_enabled?: boolean
          streak_enabled?: boolean
          updated_at?: string
        }
        Update: {
          closed_message?: string
          created_at?: string
          id?: boolean
          is_open?: boolean
          referral_enabled?: boolean
          rewards_enabled?: boolean
          streak_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      streak_checkins: {
        Row: {
          check_in_date: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          check_in_date: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          check_in_date?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      streak_milestones: {
        Row: {
          beans: number
          created_at: string
          display_label: string
          id: string
          is_active: boolean
          label: string
          repeat_every_days: number | null
          sort_order: number
          trigger_day: number
          updated_at: string
        }
        Insert: {
          beans: number
          created_at?: string
          display_label: string
          id?: string
          is_active?: boolean
          label: string
          repeat_every_days?: number | null
          sort_order?: number
          trigger_day: number
          updated_at?: string
        }
        Update: {
          beans?: number
          created_at?: string
          display_label?: string
          id?: string
          is_active?: boolean
          label?: string
          repeat_every_days?: number | null
          sort_order?: number
          trigger_day?: number
          updated_at?: string
        }
        Relationships: []
      }
      stamp_cards: {
        Row: {
          created_at: string
          current_count: number
          cycle: number
          total_stamps: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_count?: number
          cycle?: number
          total_stamps?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_count?: number
          cycle?: number
          total_stamps?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      stamp_settings: {
        Row: {
          card_size: number
          created_at: string
          free_drink_max_value: number
          id: boolean
          is_enabled: boolean
          milestone_small: number
          rm_off_amount: number
          rm_off_min_spend: number
          updated_at: string
          voucher_expiry_days: number
        }
        Insert: {
          card_size?: number
          created_at?: string
          free_drink_max_value?: number
          id?: boolean
          is_enabled?: boolean
          milestone_small?: number
          rm_off_amount?: number
          rm_off_min_spend?: number
          updated_at?: string
          voucher_expiry_days?: number
        }
        Update: {
          card_size?: number
          created_at?: string
          free_drink_max_value?: number
          id?: boolean
          is_enabled?: boolean
          milestone_small?: number
          rm_off_amount?: number
          rm_off_min_spend?: number
          updated_at?: string
          voucher_expiry_days?: number
        }
        Relationships: []
      }
      stamp_transactions: {
        Row: {
          amount: number
          created_at: string
          id: string
          is_reversal: boolean
          order_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          is_reversal?: boolean
          order_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          is_reversal?: boolean
          order_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stamp_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      vouchers: {
        Row: {
          created_at: string
          discount_amount: number
          expires_at: string
          free_drink_max_value: number
          id: string
          min_spend: number
          redeemed_order_id: string | null
          source_order_id: string | null
          status: Database["public"]["Enums"]["voucher_status"]
          type: Database["public"]["Enums"]["voucher_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          discount_amount?: number
          expires_at: string
          free_drink_max_value?: number
          id?: string
          min_spend?: number
          redeemed_order_id?: string | null
          source_order_id?: string | null
          status?: Database["public"]["Enums"]["voucher_status"]
          type: Database["public"]["Enums"]["voucher_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          discount_amount?: number
          expires_at?: string
          free_drink_max_value?: number
          id?: string
          min_spend?: number
          redeemed_order_id?: string | null
          source_order_id?: string | null
          status?: Database["public"]["Enums"]["voucher_status"]
          type?: Database["public"]["Enums"]["voucher_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vouchers_redeemed_order_id_fkey"
            columns: ["redeemed_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vouchers_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_adjust_beans: {
        Args: { p_amount: number; p_reason: string; p_user: string }
        Returns: number
      }
      admin_set_role: {
        Args: {
          p_role: Database["public"]["Enums"]["user_role"]
          p_user: string
        }
        Returns: undefined
      }
      apply_order_rewards: { Args: { p_token: string }; Returns: Json }
      attach_order_member: {
        Args: { p_identifier: string; p_token: string }
        Returns: Json
      }
      attach_order_member_store: {
        Args: { p_identifier: string; p_token: string }
        Returns: Json
      }
      claim_device_orders: { Args: { p_owner_id: string }; Returns: number }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      expire_awaiting_payment: { Args: never; Returns: undefined }
      grant_order_stamp: { Args: { p_token: string }; Returns: Json }
      mark_expired_vouchers: { Args: never; Returns: undefined }
      record_custom_drinks: { Args: { p_drinks: Json }; Returns: undefined }
      redeem_voucher: {
        Args: { p_voucher_id: string; p_order_token: string }
        Returns: Json
      }
      reverse_order_rewards: { Args: { p_token: string }; Returns: undefined }
      reverse_order_stamp: { Args: { p_token: string }; Returns: undefined }
      search_members: {
        Args: { p_query: string }
        Returns: {
          id: string
          display_name: string
          phone: string | null
          email: string | null
        }[]
      }
    }
    Enums: {
      bean_txn_category:
        | "earn"
        | "redeem"
        | "streak_bonus"
        | "referral"
        | "adjustment"
      item_status: "pending" | "preparing" | "done"
      order_source: "online" | "store" | "custom"
      order_status:
        | "pending"
        | "preparing"
        | "ready"
        | "completed"
        | "cancelled"
        | "awaiting_payment"
      user_role: "admin" | "manager" | "staff" | "customer" | "store"
      voucher_status: "active" | "redeemed" | "expired"
      voucher_type: "rm_off" | "free_drink"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      bean_txn_category: [
        "earn",
        "redeem",
        "streak_bonus",
        "referral",
        "adjustment",
      ],
      item_status: ["pending", "preparing", "done"],
      order_source: ["online", "store", "custom"],
      order_status: [
        "pending",
        "preparing",
        "ready",
        "completed",
        "cancelled",
        "awaiting_payment",
      ],
      user_role: ["admin", "manager", "staff", "customer", "store"],
      voucher_status: ["active", "redeemed", "expired"],
      voucher_type: ["rm_off", "free_drink"],
    },
  },
} as const
