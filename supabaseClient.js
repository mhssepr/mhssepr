// supabaseClient.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// URL-ውን ከዚህ ኮፒ አድርግ
const supabaseUrl = 'https://miugvibogwwvkmbhocnw.supabase.co' 

// ከዚህ በፊት በምስሉ ላይ እንዳየነው Publishable Key አስገባ
const supabaseKey = 'sb_publishable_VFsiy0GqQFzBuTamr5-dCg_a85ypcnM' 

export const supabase = createClient(supabaseUrl, supabaseKey)