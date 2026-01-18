// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://yscoewxnmsfpebfwwios.supabase.co'
const supabaseKey = 'sb_publishable_1ivi8GXvmMeu0WV6ppcrDA_B9ziqXSL'

export const supabase = createClient(supabaseUrl, supabaseKey)