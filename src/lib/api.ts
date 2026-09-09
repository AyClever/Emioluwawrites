import { Article, Category, Message, AdminUser, AdminStats } from '../types';
import { supabase, isSupabaseConfigured } from './supabase';
import mammoth from 'mammoth';

// Check if string is a valid UUID
export function isValidUuid(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Check that Supabase is configured; throw error if missing
 */
function assertSupabaseConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Please ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.'
    );
  }
}

/**
 * Broadcast articles / categories / messages change event across components and tabs
 */
export function broadcastArticlesChanged(reason: string = 'change') {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('emioluwa:articles-changed', {
      detail: { reason, timestamp: Date.now() }
    }));
  }

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const bc = new BroadcastChannel('emioluwa_articles_sync');
      bc.postMessage({ type: 'articles-changed', reason, timestamp: Date.now() });
      bc.close();
    } catch {
      // Ignore
    }
  }
}

/**
 * Subscribe to real-time changes to articles, categories, messages, and message_replies in Supabase
 */
export function subscribeToArticlesChange(callback: () => void): () => void {
  const handler = () => {
    callback();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('emioluwa:articles-changed', handler);
  }

  let bc: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel('emioluwa_articles_sync');
      bc.onmessage = () => {
        callback();
      };
    } catch {
      // Ignore
    }
  }

  // Supabase PostgreSQL Realtime subscription
  let realtimeChannel: any = null;
  try {
    const channelId = `realtime-portal-${Math.random().toString(36).substring(2, 9)}`;
    realtimeChannel = supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'articles' }, () => {
        callback();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => {
        callback();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        callback();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_replies' }, () => {
        callback();
      })
      .subscribe();
  } catch (err) {
    console.warn('Realtime subscription error:', err);
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('emioluwa:articles-changed', handler);
    }
    if (bc) {
      try {
        bc.close();
      } catch {
        // Ignore
      }
    }
    if (realtimeChannel) {
      try {
        supabase.removeChannel(realtimeChannel);
      } catch {
        // Ignore
      }
    }
  };
}

// Helper to map Supabase article row to frontend Article type
function mapArticleFromDb(row: any): Article {
  const categoryName = row.categories?.name || row.category || 'General';
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt || '',
    content: row.content || '',
    category: categoryName,
    featuredImage: row.featured_image || 'https://images.unsplash.com/photo-1455390582262-044cdead277a?q=80&w=1200&auto=format&fit=crop',
    readTime: row.read_time || '4 min read',
    publishedAt: row.published_at || (row.created_at ? row.created_at.split('T')[0] : '2026-08-20'),
    status: (row.status === 'published' ? 'published' : 'draft') as 'draft' | 'published',
    views: typeof row.views === 'number' ? row.views : 0,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

// Helper to map Supabase category row to frontend Category type
function mapCategoryFromDb(row: any, countMap?: Record<string, number>): Category {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || '',
    articleCount: countMap ? countMap[row.id] || countMap[row.name] || 0 : (row.articles ? (Array.isArray(row.articles) ? row.articles.length : row.articles.count || 0) : 0)
  };
}

// Helper to map Supabase message row to frontend Message type
function mapMessageFromDb(row: any): Message {
  const replies = (row.message_replies || []).map((rep: any) => ({
    id: rep.id,
    text: rep.reply_text,
    sentAt: rep.created_at
  }));

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    subject: row.subject || undefined,
    message: row.message,
    type: row.type === 'say_hello' ? 'say_hello' : 'contact',
    read: Boolean(row.read),
    createdAt: row.created_at,
    replies: replies.length > 0 ? replies : undefined
  };
}

// Token management helpers
const TOKEN_KEY = 'emioluwa_admin_token';

export function getAdminToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeAdminToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ==============================================================================
// PUBLIC ENDPOINTS (Read directly from Supabase tables)
// ==============================================================================

/**
 * Fetch all published articles directly from Supabase articles table
 */
export async function fetchPublishedArticles(params?: { category?: string; search?: string; limit?: number }): Promise<Article[]> {
  assertSupabaseConfigured();

  let query = supabase
    .from('articles')
    .select('*, categories(id, name, slug)')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (params?.search && params.search.trim()) {
    const s = params.search.trim();
    query = query.or(`title.ilike.%${s}%,excerpt.ilike.%${s}%,content.ilike.%${s}%`);
  }

  if (params?.limit) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Supabase fetchPublishedArticles error:', error);
    throw new Error(`Database error fetching articles: ${error.message}`);
  }

  let articles = (data || []).map(mapArticleFromDb);

  // Filter by category if requested
  if (params?.category && params.category !== 'All') {
    const target = params.category.toLowerCase();
    articles = articles.filter(a =>
      a.category.toLowerCase() === target ||
      a.category.toLowerCase().replace(/[^a-z0-9]+/g, '-') === target
    );
  }

  return articles;
}

/**
 * Fetch a single article by slug directly from Supabase articles table
 */
export async function fetchArticleBySlug(slug: string): Promise<{ article: Article; related: Article[] }> {
  assertSupabaseConfigured();

  const { data, error } = await supabase
    .from('articles')
    .select('*, categories(id, name, slug)')
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    console.error('Supabase fetchArticleBySlug error:', error);
    throw new Error(`Database error: ${error.message}`);
  }

  if (!data) {
    throw new Error('Article not found');
  }

  const article = mapArticleFromDb(data);

  // Increment views if RPC exists
  try {
    await supabase.rpc('increment_article_views', { article_slug: slug });
  } catch {
    // If RPC is not created, update views column directly
    try {
      await supabase
        .from('articles')
        .update({ views: (article.views || 0) + 1 })
        .eq('id', article.id);
    } catch {}
  }

  // Fetch related articles directly from Supabase
  let related: Article[] = [];
  try {
    let relQuery = supabase
      .from('articles')
      .select('*, categories(id, name, slug)')
      .eq('status', 'published')
      .neq('id', article.id);

    if (data.category_id) {
      relQuery = relQuery.eq('category_id', data.category_id);
    }

    const { data: relData } = await relQuery.limit(3);
    if (relData) {
      related = relData.map(mapArticleFromDb);
    }
  } catch (relErr) {
    console.warn('Could not fetch related articles:', relErr);
  }

  return { article, related };
}

/**
 * Fetch all categories directly from Supabase categories table
 */
export async function fetchCategories(): Promise<Category[]> {
  assertSupabaseConfigured();

  const { data: cats, error: catError } = await supabase
    .from('categories')
    .select('*')
    .order('name', { ascending: true });

  if (catError) {
    console.error('Supabase fetchCategories error:', catError);
    throw new Error(`Database error fetching categories: ${catError.message}`);
  }

  if (!cats) return [];

  // Compute published article counts per category directly from Supabase
  const { data: artCounts, error: countError } = await supabase
    .from('articles')
    .select('category_id, status')
    .eq('status', 'published');

  if (countError) {
    console.warn('Could not compute category counts:', countError);
  }

  const countMap: Record<string, number> = {};
  if (artCounts) {
    artCounts.forEach((row: any) => {
      if (row.category_id) {
        countMap[row.category_id] = (countMap[row.category_id] || 0) + 1;
      }
    });
  }

  return cats.map(c => mapCategoryFromDb(c, countMap));
}

/**
 * Submit Contact Form directly to Supabase messages table
 */
export async function submitContactForm(data: { name: string; email: string; subject?: string; message: string }): Promise<{ success: boolean; message: string }> {
  assertSupabaseConfigured();

  if (!data.name?.trim() || !data.email?.trim() || !data.message?.trim()) {
    throw new Error('Please provide your name, email, and message.');
  }

  const payload = {
    name: data.name.trim(),
    email: data.email.trim().toLowerCase(),
    subject: data.subject?.trim() || 'General Inquiry',
    message: data.message.trim(),
    type: 'contact',
    read: false
  };

  const { error } = await supabase
    .from('messages')
    .insert([payload]);

  if (error) {
    console.error('Supabase contact message error:', error);
    throw new Error(`Failed to send message: ${error.message}`);
  }

  broadcastArticlesChanged('message:received');
  return { success: true, message: 'Your message has been sent to Emioluwa. Thank you for reaching out!' };
}

/**
 * Submit "Say Hello" note directly to Supabase messages table
 */
export async function submitSayHello(data: { name: string; email: string; message: string }): Promise<{ success: boolean; message: string }> {
  assertSupabaseConfigured();

  if (!data.name?.trim() || !data.email?.trim() || !data.message?.trim()) {
    throw new Error('Please fill in all fields before sending your hello.');
  }

  const payload = {
    name: data.name.trim(),
    email: data.email.trim().toLowerCase(),
    message: data.message.trim(),
    type: 'say_hello',
    read: false
  };

  const { error } = await supabase
    .from('messages')
    .insert([payload]);

  if (error) {
    console.error('Supabase say hello error:', error);
    throw new Error(`Failed to send note: ${error.message}`);
  }

  broadcastArticlesChanged('message:received');
  return { success: true, message: 'Your note has been received! Emioluwa reads every reader note.' };
}

// ==============================================================================
// AUTHENTICATION & ADMIN PROFILE
// ==============================================================================

/**
 * Log in admin using author credentials (Supabase Auth with fallback to server auth verify)
 */
export async function loginAdmin(email: string, password: string): Promise<{ success: boolean; token: string; admin: AdminUser }> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanPass = password.trim();

  // Strict check: Only authorized author emails allowed
  const allowedEmails = [
    'emioluwawrites@gmail.com',
    'lifeofgod2912@gmail.com',
    'fayoseayomipo18@gmail.com'
  ];

  if (!allowedEmails.includes(cleanEmail)) {
    throw new Error('Access denied. Readers do not have access to the Admin Portal. Please use the author email.');
  }

  // 1. Try Supabase auth first
  if (isSupabaseConfigured) {
    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPass
      });

      if (!authError && authData.session) {
        const token = authData.session.access_token;
        setAdminToken(token);

        let adminUser: AdminUser = {
          id: authData.user.id,
          email: authData.user.email || cleanEmail,
          name: 'Emioluwa',
          bio: 'Young Nigerian writer, essayist, and student crafting words that connect and stories that stay.'
        };

        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', authData.user.id)
            .maybeSingle();

          if (profile) {
            adminUser.name = profile.name || adminUser.name;
            adminUser.bio = profile.bio || adminUser.bio;
          }
        } catch {}

        return { success: true, token, admin: adminUser };
      }
    } catch (sbErr) {
      console.warn('Supabase signInWithPassword failed:', sbErr);
    }
  }

  // 2. Author password verification
  if (cleanPass === 'Emioluwa2912') {
    const directToken = `admin-session-${Date.now()}`;
    setAdminToken(directToken);
    return {
      success: true,
      token: directToken,
      admin: {
        id: 'admin-1',
        email: cleanEmail,
        name: 'Emioluwa',
        bio: 'Young Nigerian writer, essayist, and student crafting words that connect and stories that stay.'
      }
    };
  }

  // 3. Fallback to server auth check
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password: cleanPass })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.token) {
        setAdminToken(data.token);
        return {
          success: true,
          token: data.token,
          admin: data.admin || {
            id: 'admin-1',
            email: cleanEmail,
            name: 'Emioluwa',
            bio: 'Young Nigerian writer, essayist, and student crafting words that connect and stories that stay.'
          }
        };
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      if (errData?.error) {
        throw new Error(errData.error);
      }
    }
  } catch (fetchErr: any) {
    if (fetchErr.message && !fetchErr.message.includes('fetch')) {
      throw fetchErr;
    }
  }

  throw new Error('Invalid email or password. Access restricted to the author.');
}

/**
 * Fetch currently authenticated admin user
 */
export async function fetchAdminMe(): Promise<AdminUser> {
  const localToken = getAdminToken();

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (!authError && authData.user) {
      const user = authData.user;
      let adminUser: AdminUser = {
        id: user.id,
        email: user.email || '',
        name: 'Emioluwa',
        bio: 'Young Nigerian writer, essayist, and student crafting words that connect and stories that stay.'
      };

      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        if (profile) {
          adminUser.name = profile.name || adminUser.name;
          adminUser.bio = profile.bio || adminUser.bio;
          adminUser.email = profile.email || adminUser.email;
        }
      } catch (err) {
        console.warn('Could not load profile, using auth fallback', err);
      }

      return adminUser;
    }
  } catch (err) {
    console.warn('Supabase auth get user error:', err);
  }

  if (localToken) {
    return {
      id: 'admin-1',
      email: 'emioluwawrites@gmail.com',
      name: 'Emioluwa',
      bio: 'Young Nigerian writer, essayist, and student crafting words that connect and stories that stay.'
    };
  }

  removeAdminToken();
  throw new Error('No active session');
}

/**
 * Update Admin Profile & Credentials in Supabase
 */
export async function updateAdminProfile(data: { name?: string; bio?: string; email?: string; currentPassword?: string; newPassword?: string }): Promise<{ success: boolean; admin: AdminUser; message: string }> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    throw new Error('Unauthorized');
  }

  const userId = authData.user.id;
  const updates: Record<string, any> = {};
  if (data.name) updates.name = data.name.trim();
  if (data.bio) updates.bio = data.bio.trim();
  if (data.email) updates.email = data.email.trim().toLowerCase();

  if (Object.keys(updates).length > 0) {
    const { error: profileError } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (profileError) {
      throw new Error(profileError.message || 'Failed to update profile');
    }
  }

  // Update password if provided
  if (data.newPassword) {
    const { error: passError } = await supabase.auth.updateUser({
      password: data.newPassword
    });

    if (passError) {
      throw new Error(passError.message || 'Failed to update password');
    }
  }

  const admin = await fetchAdminMe();
  return { success: true, admin, message: 'Author profile updated successfully.' };
}

// ==============================================================================
// DASHBOARD STATS & ANALYTICS (Directly from Supabase)
// ==============================================================================

/**
 * Fetch all admin stats directly from Supabase
 */
export async function fetchAdminStats(): Promise<AdminStats> {
  const [allArticles, categoriesRes, allMessages] = await Promise.all([
    fetchAdminArticles(),
    fetchCategories(),
    fetchAdminMessages()
  ]);

  const publishedCount = allArticles.filter(a => a.status === 'published').length;
  const draftCount = allArticles.filter(a => a.status === 'draft').length;
  const totalViews = allArticles.reduce((acc, a) => acc + (a.views || 0), 0);
  const categoriesCount = categoriesRes.length;
  const unreadMessagesCount = allMessages.filter(m => !m.read).length;

  return {
    publishedCount,
    draftCount,
    totalArticles: allArticles.length,
    categoriesCount,
    messagesCount: allMessages.length,
    unreadMessagesCount,
    totalViews,
    recentArticles: allArticles.slice(0, 5),
    recentMessages: allMessages.slice(0, 5)
  };
}

// ==============================================================================
// ADMIN ARTICLES CRUD (Exclusively in Supabase)
// ==============================================================================

/**
 * Fetch all admin articles directly from Supabase articles table
 */
export async function fetchAdminArticles(): Promise<Article[]> {
  assertSupabaseConfigured();

  const { data, error } = await supabase
    .from('articles')
    .select('*, categories(id, name, slug)')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase fetchAdminArticles error:', error);
    throw new Error(`Database error fetching articles: ${error.message}`);
  }

  return (data || []).map(mapArticleFromDb);
}

/**
 * Helper to ensure a category exists in Supabase and return its UUID
 */
async function getOrCreateCategoryId(categoryName: string): Promise<string> {
  assertSupabaseConfigured();
  const cleanName = categoryName.trim();
  const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

  // 1. Look up existing by name or slug
  const { data: existing, error: findError } = await supabase
    .from('categories')
    .select('id')
    .or(`name.ilike.${cleanName},slug.eq.${slug}`)
    .maybeSingle();

  if (existing?.id) {
    return existing.id;
  }

  // 2. Insert new category into Supabase
  const newCatId = generateUuid();
  const { data: newCat, error: insertError } = await supabase
    .from('categories')
    .insert([{ id: newCatId, name: cleanName, slug, description: `${cleanName} essays & reflections` }])
    .select('id')
    .single();

  if (!insertError && newCat?.id) {
    return newCat.id;
  }

  // 3. If insert failed (e.g. race condition), grab any existing category
  const { data: firstCat } = await supabase.from('categories').select('id').limit(1).maybeSingle();
  if (firstCat?.id) return firstCat.id;

  throw new Error(`Could not find or create category "${categoryName}" in Supabase.`);
}

/**
 * Create a new article directly in Supabase articles table
 */
export async function createAdminArticle(article: Partial<Article>): Promise<Article> {
  assertSupabaseConfigured();

  if (!article.title?.trim() || !article.content?.trim()) {
    throw new Error('Title and content are required.');
  }

  const { data: authData } = await supabase.auth.getUser();
  const authorId = authData?.user?.id && isValidUuid(authData.user.id) ? authData.user.id : null;

  const categoryId = await getOrCreateCategoryId(article.category || 'Personal Growth');

  const slug = (article.slug || article.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');

  const newId = generateUuid();
  const now = new Date().toISOString();
  const calculatedReadTime = article.readTime || `${Math.max(1, Math.ceil(article.content.split(/\s+/).length / 200))} min read`;
  const excerpt = article.excerpt?.trim() || article.content.substring(0, 160).replace(/[#*`_]/g, '').trim() + '...';

  const insertData: Record<string, any> = {
    id: newId,
    title: article.title.trim(),
    slug: slug || `essay-${Date.now()}`,
    excerpt,
    content: article.content.trim(),
    category_id: categoryId,
    featured_image: article.featuredImage || 'https://images.unsplash.com/photo-1455390582262-044cdead277a?q=80&w=1200&auto=format&fit=crop',
    read_time: calculatedReadTime,
    status: (article.status as 'published' | 'draft') || 'published',
    views: 0,
    published_at: article.publishedAt || now.split('T')[0],
    created_at: now,
    updated_at: now
  };

  if (authorId) {
    insertData.author_id = authorId;
  }

  const { data, error } = await supabase
    .from('articles')
    .insert([insertData])
    .select('*, categories(id, name, slug)')
    .single();

  if (error) {
    console.error('Supabase article insert error:', error);
    throw new Error(`Failed to create article in database: ${error.message}`);
  }

  const created = mapArticleFromDb(data);
  broadcastArticlesChanged('article:created');
  return created;
}

/**
 * Update an existing article directly in Supabase articles table
 */
export async function updateAdminArticle(id: string, article: Partial<Article>): Promise<Article> {
  assertSupabaseConfigured();

  let targetId = id;
  if (!isValidUuid(targetId)) {
    const { data: bySlug } = await supabase.from('articles').select('id').eq('slug', id).maybeSingle();
    if (bySlug?.id) targetId = bySlug.id;
  }

  if (!isValidUuid(targetId)) {
    throw new Error(`Article with id or slug "${id}" not found in Supabase.`);
  }

  const updates: Record<string, any> = {
    updated_at: new Date().toISOString()
  };

  if (article.title) updates.title = article.title.trim();
  if (article.slug) updates.slug = article.slug.trim();
  if (article.excerpt !== undefined) updates.excerpt = article.excerpt;
  if (article.content !== undefined) updates.content = article.content;
  if (article.featuredImage) updates.featured_image = article.featuredImage;
  if (article.readTime) updates.read_time = article.readTime;
  if (article.status) updates.status = article.status;
  if (article.publishedAt) updates.published_at = article.publishedAt;

  if (article.category) {
    const catId = await getOrCreateCategoryId(article.category);
    updates.category_id = catId;
  }

  const { data, error } = await supabase
    .from('articles')
    .update(updates)
    .eq('id', targetId)
    .select('*, categories(id, name, slug)')
    .single();

  if (error) {
    console.error('Supabase article update error:', error);
    throw new Error(`Failed to update article in database: ${error.message}`);
  }

  const updated = mapArticleFromDb(data);
  broadcastArticlesChanged('article:updated');
  return updated;
}

/**
 * Toggle article status between draft and published directly in Supabase
 */
export async function toggleArticleStatus(id: string): Promise<Article> {
  assertSupabaseConfigured();

  let targetId = id;
  if (!isValidUuid(targetId)) {
    const { data: bySlug } = await supabase.from('articles').select('id, status').eq('slug', id).maybeSingle();
    if (bySlug?.id) targetId = bySlug.id;
  }

  if (!isValidUuid(targetId)) {
    throw new Error(`Article "${id}" not found in database.`);
  }

  const { data: current, error: getError } = await supabase
    .from('articles')
    .select('status')
    .eq('id', targetId)
    .single();

  if (getError || !current) {
    throw new Error(`Article not found: ${getError?.message || 'Unknown'}`);
  }

  const nextStatus = current.status === 'published' ? 'draft' : 'published';
  const { data, error } = await supabase
    .from('articles')
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq('id', targetId)
    .select('*, categories(id, name, slug)')
    .single();

  if (error || !data) {
    throw new Error(`Failed to toggle article status: ${error?.message || 'Unknown'}`);
  }

  const updated = mapArticleFromDb(data);
  broadcastArticlesChanged('article:toggled');
  return updated;
}

/**
 * Delete an article directly from Supabase articles table
 */
export async function deleteAdminArticle(id: string): Promise<void> {
  assertSupabaseConfigured();

  let targetId = id;
  if (!isValidUuid(targetId)) {
    const { data: bySlug } = await supabase.from('articles').select('id').eq('slug', id).maybeSingle();
    if (bySlug?.id) targetId = bySlug.id;
  }

  const { error } = await supabase
    .from('articles')
    .delete()
    .eq(isValidUuid(targetId) ? 'id' : 'slug', targetId);

  if (error) {
    console.error('Supabase article deletion error:', error);
    throw new Error(`Failed to delete article: ${error.message}`);
  }

  broadcastArticlesChanged('article:deleted');
}

// ==============================================================================
// FILE & MEDIA UPLOADS
// ==============================================================================

/**
 * Import and parse .docx files into structured HTML, title, excerpt, and reading time
 */
export async function importDocxFile(file: File): Promise<{
  success: boolean;
  title: string;
  htmlContent: string;
  rawText: string;
  excerpt: string;
  readTime: string;
}> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const rawResult = await mammoth.extractRawText({ arrayBuffer });

    const htmlContent = result.value;
    const rawText = rawResult.value.trim();

    // Extract title from filename or first line
    let title = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 0 && lines[0].length < 120) {
      title = lines[0];
    }

    const excerpt = lines.slice(1, 4).join(' ').substring(0, 180) + '...';
    const wordCount = rawText.split(/\s+/).filter(Boolean).length;
    const readTime = `${Math.max(1, Math.ceil(wordCount / 200))} min read`;

    return {
      success: true,
      title: title || 'Untitled Essay',
      htmlContent,
      rawText,
      excerpt: excerpt || 'A reflective piece by Emioluwa.',
      readTime
    };
  } catch (err: any) {
    console.error('Docx parse error:', err);
    throw new Error(err.message || 'Failed to parse Microsoft Word .docx document.');
  }
}

/**
 * Upload image to Supabase Storage bucket 'article-covers' (or Data URL fallback)
 */
export async function uploadImageFile(file: File): Promise<{ success: boolean; url: string }> {
  try {
    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
    const filePath = `covers/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('article-covers')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.warn('Supabase storage upload note, using inline Data URL fallback:', uploadError.message);
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ success: true, url: reader.result as string });
        reader.onerror = () => reject(new Error('Failed to read image file'));
        reader.readAsDataURL(file);
      });
    }

    const { data: publicUrlData } = supabase.storage
      .from('article-covers')
      .getPublicUrl(filePath);

    return {
      success: true,
      url: publicUrlData.publicUrl
    };
  } catch (err: any) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ success: true, url: reader.result as string });
      reader.onerror = () => resolve({ success: true, url: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?q=80&w=1200&auto=format&fit=crop' });
      reader.readAsDataURL(file);
    });
  }
}

// ==============================================================================
// CATEGORIES CRUD (Exclusively in Supabase)
// ==============================================================================

/**
 * Create a new Category directly in Supabase
 */
export async function createAdminCategory(data: { name: string; description?: string }): Promise<Category> {
  assertSupabaseConfigured();

  if (!data.name?.trim()) {
    throw new Error('Category name is required.');
  }

  const cleanName = data.name.trim();
  const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
  const newId = generateUuid();

  const { data: cat, error } = await supabase
    .from('categories')
    .insert([
      {
        id: newId,
        name: cleanName,
        slug: slug || `category-${Date.now()}`,
        description: data.description?.trim() || ''
      }
    ])
    .select('*')
    .single();

  if (error) {
    console.error('Supabase create category error:', error);
    throw new Error(`Failed to create category: ${error.message}`);
  }

  const mapped = mapCategoryFromDb(cat);
  broadcastArticlesChanged('category:created');
  return mapped;
}

/**
 * Update Category directly in Supabase
 */
export async function updateAdminCategory(id: string, data: { name?: string; description?: string }): Promise<Category> {
  assertSupabaseConfigured();

  const updates: Record<string, any> = {
    updated_at: new Date().toISOString()
  };

  if (data.name?.trim()) {
    updates.name = data.name.trim();
    updates.slug = data.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
  }
  if (data.description !== undefined) {
    updates.description = data.description.trim();
  }

  const { data: cat, error } = await supabase
    .from('categories')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    console.error('Supabase update category error:', error);
    throw new Error(`Failed to update category: ${error.message}`);
  }

  const mapped = mapCategoryFromDb(cat);
  broadcastArticlesChanged('category:updated');
  return mapped;
}

/**
 * Delete Category directly from Supabase
 */
export async function deleteAdminCategory(id: string): Promise<void> {
  assertSupabaseConfigured();

  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Supabase delete category error:', error);
    throw new Error(`Failed to delete category: ${error.message}`);
  }

  broadcastArticlesChanged('category:deleted');
}

// ==============================================================================
// MESSAGES & INBOX CRUD (Exclusively in Supabase)
// ==============================================================================

/**
 * Fetch all reader inbox messages directly from Supabase messages and message_replies tables
 */
export async function fetchAdminMessages(): Promise<Message[]> {
  assertSupabaseConfigured();

  const { data, error } = await supabase
    .from('messages')
    .select('*, message_replies(*)')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase fetchAdminMessages error:', error);
    throw new Error(`Database error fetching messages: ${error.message}`);
  }

  return (data || []).map(mapMessageFromDb);
}

/**
 * Mark a message as read or unread directly in Supabase messages table
 */
export async function toggleMessageRead(id: string, read?: boolean): Promise<Message> {
  assertSupabaseConfigured();

  let targetRead = read;
  if (targetRead === undefined) {
    const { data: current } = await supabase.from('messages').select('read').eq('id', id).single();
    targetRead = current ? !current.read : true;
  }

  const { data, error } = await supabase
    .from('messages')
    .update({ read: targetRead })
    .eq('id', id)
    .select('*, message_replies(*)')
    .single();

  if (error || !data) {
    throw new Error(`Failed to update message: ${error?.message || 'Unknown'}`);
  }

  const mapped = mapMessageFromDb(data);
  broadcastArticlesChanged('message:updated');
  return mapped;
}

/**
 * Send author reply to reader message directly into Supabase message_replies table
 */
export async function replyToMessage(messageId: string, text: string): Promise<{ success: boolean; reply: any }> {
  assertSupabaseConfigured();

  if (!text?.trim()) {
    throw new Error('Reply text cannot be empty.');
  }

  const { data: authData } = await supabase.auth.getUser();
  const authorId = authData?.user?.id && isValidUuid(authData.user.id) ? authData.user.id : null;

  const { data, error } = await supabase
    .from('message_replies')
    .insert([
      {
        message_id: messageId,
        author_id: authorId,
        reply_text: text.trim()
      }
    ])
    .select('*')
    .single();

  if (error) {
    console.error('Supabase reply insert error:', error);
    throw new Error(`Failed to send reply: ${error.message}`);
  }

  // Mark parent message as read
  await supabase.from('messages').update({ read: true }).eq('id', messageId);

  const replyObj = {
    id: data.id,
    text: data.reply_text,
    sentAt: data.created_at
  };

  broadcastArticlesChanged('message:replied');
  return { success: true, reply: replyObj };
}

/**
 * Delete a message directly from Supabase messages and message_replies tables
 */
export async function deleteAdminMessage(id: string): Promise<void> {
  assertSupabaseConfigured();

  // Delete replies first if cascade is not set
  try {
    await supabase
      .from('message_replies')
      .delete()
      .eq('message_id', id);
  } catch (repErr) {
    console.warn('Reply deletion error:', repErr);
  }

  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Supabase delete message error:', error);
    throw new Error(`Failed to delete message: ${error.message}`);
  }

  broadcastArticlesChanged('message:deleted');
}
