import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = 'https://jlmyrmoxicgekuazomkg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsbXlybW94aWNnZWt1YXpvbWtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEzOTA5NjIsImV4cCI6MjA3Njk2Njk2Mn0.CIW3y2eyLUyNbrGS6_Y9BS5Yqi44wnHisusQjA_Df44';

export const supabase = createClient(supabaseUrl, supabaseKey);

export const AuthAPI = {
  async checkSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  },

  async getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    return profile;
  },

  async getUserPreferences(userId) {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async updateUserProfile(userId, updates) {
    const { data, error } = await supabase
      .from('user_profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateUserPreferences(userId, updates) {
    const { data, error } = await supabase
      .from('user_preferences')
      .update(updates)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    window.location.href = './auth.html';
  },

  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
      (async () => {
        callback(event, session);
      })();
    });
  }
};
