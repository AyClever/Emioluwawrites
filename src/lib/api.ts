import { Article, Category, Message, AdminUser, AdminStats } from '../types';
import { supabase } from './supabase';
import mammoth from 'mammoth';

// Check if string is a valid UUID
export function isValidUuid(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// Fallback seed categories with valid UUIDs
const FALLBACK_CATEGORIES: Category[] = [
  {
    id: '11111111-1111-4111-8111-111111111101',
    name: 'Student Life',
    slug: 'student-life',
    description: 'Reflections from lecture halls, hostel corridors, exams, and the messy beauty of school.',
    articleCount: 2
  },
  {
    id: '11111111-1111-4111-8111-111111111102',
    name: 'Personal Growth',
    slug: 'personal-growth',
    description: 'Lessons on patience, discipline, navigating setbacks, and building character in your twenties.',
    articleCount: 1
  },
  {
    id: '11111111-1111-4111-8111-111111111103',
    name: 'Self-Discovery',
    slug: 'self-discovery',
    description: 'Unravelling identity, finding your voice, understanding your inner compass, and gentle honesty.',
    articleCount: 1
  },
  {
    id: '11111111-1111-4111-8111-111111111104',
    name: 'Life Experiences',
    slug: 'life-experiences',
    description: 'Moments from Lagos to Ibadan, rainy mornings, family dinners, and ordinary days turned into essays.',
    articleCount: 1
  },
  {
    id: '11111111-1111-4111-8111-111111111105',
    name: 'Opinions',
    slug: 'opinions',
    description: 'Thoughtful perspectives on modern culture, reading habits, friendship dynamics, and youthful ambition.',
    articleCount: 1
  },
  {
    id: '11111111-1111-4111-8111-111111111106',
    name: 'Creative Writing',
    slug: 'creative-writing',
    description: 'Short stories, poetic prose, vignettes, and narratives crafted with heart and imagery.',
    articleCount: 1
  }
];

// Local storage keys for resilient persistence
const LOCAL_ARTICLES_KEY = 'emioluwa_local_articles';
const LOCAL_CATEGORIES_KEY = 'emioluwa_local_categories';
const LOCAL_DELETED_ARTICLES_KEY = 'emioluwa_deleted_article_ids';
const LOCAL_DELETED_CATEGORIES_KEY = 'emioluwa_deleted_category_ids';
const LOCAL_MODIFIED_CATEGORIES_KEY = 'emioluwa_modified_categories';
const LOCAL_SYNC_KEY = 'emioluwa_last_sync';

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

function getDeletedArticleIds(): Set<string> {
  try {
    const raw = localStorage.getItem(LOCAL_DELETED_ARTICLES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch {
    // Ignore error
  }
  return new Set();
}

function markArticleDeleted(idOrSlug: string, additionalKey?: string) {
  try {
    const set = getDeletedArticleIds();
    if (idOrSlug) set.add(idOrSlug);
    if (additionalKey) set.add(additionalKey);
    localStorage.setItem(LOCAL_DELETED_ARTICLES_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Ignore error
  }
}

function unmarkArticleDeleted(idOrSlug: string, additionalKey?: string) {
  try {
    const set = getDeletedArticleIds();
    if (idOrSlug) set.delete(idOrSlug);
    if (additionalKey) set.delete(additionalKey);
    localStorage.setItem(LOCAL_DELETED_ARTICLES_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Ignore error
  }
}

function getDeletedCategoryIds(): Set<string> {
  try {
    const raw = localStorage.getItem(LOCAL_DELETED_CATEGORIES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed);
    }
  } catch {
    // Ignore error
  }
  return new Set();
}

function markCategoryDeleted(idOrSlug: string) {
  try {
    const set = getDeletedCategoryIds();
    if (idOrSlug) set.add(idOrSlug);
    localStorage.setItem(LOCAL_DELETED_CATEGORIES_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Ignore error
  }
}

function unmarkCategoryDeleted(idOrSlug: string, additionalKey?: string) {
  try {
    const set = getDeletedCategoryIds();
    if (idOrSlug) set.delete(idOrSlug);
    if (additionalKey) set.delete(additionalKey);
    localStorage.setItem(LOCAL_DELETED_CATEGORIES_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Ignore error
  }
}

function getModifiedCategories(): Record<string, Partial<Category>> {
  try {
    const raw = localStorage.getItem(LOCAL_MODIFIED_CATEGORIES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    }
  } catch {
    // Ignore error
  }
  return {};
}

function saveModifiedCategory(key: string, data: Partial<Category>) {
  try {
    const current = getModifiedCategories();
    current[key] = { ...(current[key] || {}), ...data };
    localStorage.setItem(LOCAL_MODIFIED_CATEGORIES_KEY, JSON.stringify(current));
  } catch {
    // Ignore error
  }
}

function removeModifiedCategory(key: string) {
  try {
    const current = getModifiedCategories();
    delete current[key];
    localStorage.setItem(LOCAL_MODIFIED_CATEGORIES_KEY, JSON.stringify(current));
  } catch {
    // Ignore error
  }
}

/**
 * Broadcast articles / categories change event in real-time across components, windows & tabs
 */
export function broadcastArticlesChanged(reason: string = 'change') {
  try {
    localStorage.setItem(LOCAL_SYNC_KEY, Date.now().toString());
  } catch {
    // Ignore
  }

  // Custom DOM event
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('emioluwa:articles-changed', {
      detail: { reason, timestamp: Date.now() }
    }));
  }

  // BroadcastChannel for cross-tab instant messaging
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
 * Subscribe to real-time changes to articles and categories
 */
export function subscribeToArticlesChange(callback: () => void): () => void {
  const handler = () => {
    callback();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('emioluwa:articles-changed', handler);
    window.addEventListener('storage', (e) => {
      if (
        e.key === LOCAL_ARTICLES_KEY || 
        e.key === LOCAL_CATEGORIES_KEY || 
        e.key === LOCAL_DELETED_ARTICLES_KEY || 
        e.key === LOCAL_SYNC_KEY
      ) {
        callback();
      }
    });
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
    const channelId = `realtime-articles-${Math.random().toString(36).substring(2, 9)}`;
    realtimeChannel = supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'articles' }, () => {
        callback();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => {
        callback();
      })
      .subscribe();
  } catch {
    // Realtime channel fallback
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

const LEGACY_DEMO_SLUGS = new Set([
  'the-quiet-art-of-becoming',
  'hostel-nights-and-yellow-notebooks',
  'why-i-keep-writing-letters-to-strangers',
  'the-books-that-rebuilt-my-attention-span',
  'draft-embracing-uncertainty-in-final-year',
  'art-1',
  'art-2',
  'art-3',
  'art-4',
  'art-5',
  '22222222-2222-4222-8222-222222222201',
  '22222222-2222-4222-8222-222222222202',
  '22222222-2222-4222-8222-222222222203',
  '22222222-2222-4222-8222-222222222204'
]);

function getLocalArticles(): Article[] {
  try {
    const raw = localStorage.getItem(LOCAL_ARTICLES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(a => a && !LEGACY_DEMO_SLUGS.has(a.slug) && !LEGACY_DEMO_SLUGS.has(a.id));
      }
    }
  } catch {
    // Ignore error
  }
  return [];
}

function saveLocalArticles(articles: Article[]) {
  try {
    const cleaned = articles.filter(a => a && !LEGACY_DEMO_SLUGS.has(a.slug) && !LEGACY_DEMO_SLUGS.has(a.id));
    localStorage.setItem(LOCAL_ARTICLES_KEY, JSON.stringify(cleaned));
  } catch {
    // Ignore error
  }
}

function getLocalCategories(): Category[] {
  try {
    const raw = localStorage.getItem(LOCAL_CATEGORIES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Ignore error
  }
  return [];
}

function saveLocalCategories(cats: Category[]) {
  try {
    localStorage.setItem(LOCAL_CATEGORIES_KEY, JSON.stringify(cats));
  } catch {
    // Ignore error
  }
}

// Fallback seed articles (cleared so user has fresh slate for their real content)
const FALLBACK_ARTICLES: Article[] = [];

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

// Token management helpers for legacy / custom token storage
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
// PUBLIC ENDPOINTS (Connected to Supabase)
// ==============================================================================

/**
 * Fetch all published articles with optional category and search filters
 */
export async function fetchPublishedArticles(params?: { category?: string; search?: string; limit?: number }): Promise<Article[]> {
  const deletedSet = getDeletedArticleIds();
  let dbArticles: Article[] = [];
  try {
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
    if (!error && data && data.length > 0) {
      dbArticles = data.map(mapArticleFromDb);
    }
  } catch (err) {
    console.warn('Error fetching articles from Supabase:', err);
  }

  // Also fetch from server API to guarantee cross-device updates
  try {
    const serverUrl = '/api/articles' + (params?.category && params.category !== 'All' ? `?category=${encodeURIComponent(params.category)}` : '');
    const serverRes = await fetch(serverUrl);
    if (serverRes.ok) {
      const serverArticles: Article[] = await serverRes.json();
      if (Array.isArray(serverArticles)) {
        for (const item of serverArticles) {
          if (!dbArticles.some(a => a.id === item.id || a.slug === item.slug)) {
            dbArticles.push(item);
          }
        }
      }
    }
  } catch (err) {
    // Graceful fallback
  }

  // If Supabase returned published articles, use them as the primary source of truth!
  // Only use local storage articles if Supabase returned 0 items (e.g. offline fallback)
  let combined: Article[] = [];
  if (dbArticles.length > 0) {
    combined = [...dbArticles];
  } else {
    const localArticles = getLocalArticles().filter(a => a.status === 'published');
    if (localArticles.length > 0) {
      combined = [...localArticles];
    } else {
      combined = [...FALLBACK_ARTICLES.filter(a => a.status === 'published')];
    }
  }

  // Filter out any deleted articles
  combined = combined.filter(a => !deletedSet.has(a.id) && !deletedSet.has(a.slug));

  // Sort newest first
  combined.sort((a, b) => new Date(b.publishedAt || b.createdAt).getTime() - new Date(a.publishedAt || a.createdAt).getTime());

  return filterArticlesList(combined, params);
}

function filterArticlesList(list: Article[], params?: { category?: string; search?: string; limit?: number }): Article[] {
  let filtered = [...list];
  if (params?.category && params.category !== 'All') {
    const target = params.category.toLowerCase();
    filtered = filtered.filter(a => a.category.toLowerCase() === target || a.category.toLowerCase().replace(/[^a-z0-9]+/g, '-') === target);
  }
  if (params?.search) {
    const s = params.search.toLowerCase();
    filtered = filtered.filter(a => a.title.toLowerCase().includes(s) || a.excerpt.toLowerCase().includes(s) || a.content.toLowerCase().includes(s));
  }
  if (params?.limit) {
    filtered = filtered.slice(0, params.limit);
  }
  return filtered;
}

/**
 * Sync helper to persist article changes to the server database
 */
async function syncArticleToServer(action: 'upsert' | 'delete', article?: Partial<Article>, articleId?: string) {
  try {
    await fetch('/api/articles/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, article, articleId })
    });
  } catch {
    // Ignore server sync failure on static preview
  }
}

/**
 * Fetch a single article by slug and its related articles
 */
export async function fetchArticleBySlug(slug: string): Promise<{ article: Article; related: Article[] }> {
  const deletedSet = getDeletedArticleIds();
  if (deletedSet.has(slug)) {
    throw new Error('Article not found');
  }

  try {
    const { data } = await supabase
      .from('articles')
      .select('*, categories(id, name, slug)')
      .eq('slug', slug)
      .maybeSingle();

    let article: Article | null = null;

    if (data) {
      article = mapArticleFromDb(data);
      try {
        await supabase.rpc('increment_article_views', { article_slug: slug });
      } catch {
        // RPC fallback
      }
    }

    if (!article) {
      try {
        const res = await fetch(`/api/articles/${encodeURIComponent(slug)}`);
        if (res.ok) {
          const srvData = await res.json();
          if (srvData?.article) article = srvData.article;
        }
      } catch {
        // Ignore
      }
    }

    if (!article) {
      const local = getLocalArticles().find(a => a.slug === slug || a.id === slug);
      if (local) article = local;
    }

    if (!article) {
      const found = FALLBACK_ARTICLES.find(a => a.slug === slug || a.id === slug);
      if (found) article = found;
    }

    if (!article || deletedSet.has(article.id) || deletedSet.has(article.slug)) {
      throw new Error('Article not found');
    }

    // Related articles
    const allPublished = await fetchPublishedArticles();
    const related = allPublished.filter(a => a.slug !== slug && a.id !== article!.id).slice(0, 3);

    return { article, related };
  } catch (err: any) {
    throw new Error(err.message || 'Article not found');
  }
}

/**
 * Fetch all categories
 */
export async function fetchCategories(): Promise<Category[]> {
  const deletedCatSet = getDeletedCategoryIds();
  const modifiedMap = getModifiedCategories();
  let dbCats: Category[] = [];

  try {
    const { data: cats, error: catError } = await supabase
      .from('categories')
      .select('*')
      .order('name', { ascending: true });

    if (!catError && cats && cats.length > 0) {
      // Compute article counts per category
      const { data: artCounts } = await supabase
        .from('articles')
        .select('category_id, status')
        .eq('status', 'published');

      const countMap: Record<string, number> = {};
      if (artCounts) {
        artCounts.forEach((row: any) => {
          if (row.category_id) {
            countMap[row.category_id] = (countMap[row.category_id] || 0) + 1;
          }
        });
      }

      dbCats = cats.map(c => mapCategoryFromDb(c, countMap));
    }
  } catch {
    // Supabase fallback
  }

  // If no categories from Supabase, try backend server /api/categories
  if (dbCats.length === 0) {
    try {
      const res = await fetch('/api/categories');
      if (res.ok) {
        const srvCats = await res.json();
        if (Array.isArray(srvCats) && srvCats.length > 0) {
          dbCats = srvCats.map((c: any) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            description: c.description || '',
            articleCount: c.articleCount || 0
          }));
        }
      }
    } catch {
      // Ignore error
    }
  }

  // Apply any client-side modifications onto dbCats
  dbCats = dbCats.map(cat => {
    const mod = modifiedMap[cat.id] || modifiedMap[cat.slug] || modifiedMap[cat.name.toLowerCase()];
    if (mod) {
      return {
        ...cat,
        name: mod.name || cat.name,
        slug: mod.slug || cat.slug,
        description: mod.description !== undefined ? mod.description : cat.description
      };
    }
    return cat;
  });

  const localCats = getLocalCategories();
  let combined = [...dbCats];

  for (const item of localCats) {
    const mod = modifiedMap[item.id] || modifiedMap[item.slug] || modifiedMap[item.name.toLowerCase()];
    const resolvedItem = mod ? { ...item, ...mod } : item;
    const existingIndex = combined.findIndex(c => c.id === resolvedItem.id || c.slug === resolvedItem.slug);

    if (existingIndex !== -1) {
      combined[existingIndex] = { ...combined[existingIndex], ...resolvedItem };
    } else {
      combined.push(resolvedItem);
    }
  }

  if (combined.length === 0) {
    for (const item of FALLBACK_CATEGORIES) {
      const mod = modifiedMap[item.id] || modifiedMap[item.slug] || modifiedMap[item.name.toLowerCase()];
      const resolvedItem = mod ? { ...item, ...mod } : item;
      if (!combined.some(c => c.id === resolvedItem.id || c.slug === resolvedItem.slug)) {
        combined.push(resolvedItem);
      }
    }
  }

  // Strictly filter out any deleted categories
  combined = combined.filter(c => 
    !deletedCatSet.has(c.id) && 
    !deletedCatSet.has(c.slug) &&
    !deletedCatSet.has(c.name.toLowerCase())
  );

  return combined;
}

const LOCAL_MESSAGES_KEY = 'emioluwa_local_messages';
const DELETED_MESSAGES_KEY = 'emioluwa_deleted_messages';
const READ_MESSAGES_KEY = 'emioluwa_read_messages';

export function getReadMessageIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_MESSAGES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function addReadMessageId(id: string): void {
  try {
    const set = getReadMessageIds();
    set.add(id);
    localStorage.setItem(READ_MESSAGES_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

export function removeReadMessageId(id: string): void {
  try {
    const set = getReadMessageIds();
    set.delete(id);
    localStorage.setItem(READ_MESSAGES_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

export function getDeletedMessageIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_MESSAGES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function addDeletedMessageId(id: string): void {
  try {
    const set = getDeletedMessageIds();
    set.add(id);
    localStorage.setItem(DELETED_MESSAGES_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

export function getLocalMessages(): Message[] {
  try {
    const raw = localStorage.getItem(LOCAL_MESSAGES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalMessage(msg: Message): void {
  try {
    const list = getLocalMessages();
    const filtered = list.filter(m => m.id !== msg.id);
    filtered.unshift(msg);
    localStorage.setItem(LOCAL_MESSAGES_KEY, JSON.stringify(filtered));
  } catch {}
}

export function removeLocalMessage(id: string): void {
  try {
    const list = getLocalMessages();
    const filtered = list.filter(m => m.id !== id);
    localStorage.setItem(LOCAL_MESSAGES_KEY, JSON.stringify(filtered));
  } catch {}
}

/**
 * Submit Contact Form
 */
export async function submitContactForm(data: { name: string; email: string; subject?: string; message: string }): Promise<{ success: boolean; message: string }> {
  if (!data.name?.trim() || !data.email?.trim() || !data.message?.trim()) {
    throw new Error('Please provide your name, email, and message.');
  }

  const payload = {
    name: data.name.trim(),
    email: data.email.trim().toLowerCase(),
    subject: data.subject?.trim() || 'General Inquiry',
    message: data.message.trim(),
  };

  // 1. Submit to server API (persisted to server database data/db.json)
  try {
    await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn('Server contact form submission note:', err);
  }

  // 2. Also try Supabase if connected
  try {
    const { error } = await supabase
      .from('messages')
      .insert([
        {
          ...payload,
          type: 'contact',
          read: false
        }
      ]);

    if (error) {
      console.warn('Supabase contact message note:', error.message);
    }
  } catch (err) {
    console.warn('Supabase contact form submission handled:', err);
  }

  // 3. Save to local storage for instant availability
  saveLocalMessage({
    id: 'msg-' + Date.now(),
    name: payload.name,
    email: payload.email,
    subject: payload.subject,
    message: payload.message,
    type: 'contact',
    read: false,
    createdAt: new Date().toISOString()
  });

  return { success: true, message: 'Your message has been sent to Emioluwa. Thank you for reaching out!' };
}

/**
 * Submit "Say Hello" note
 */
export async function submitSayHello(data: { name: string; email: string; message: string }): Promise<{ success: boolean; message: string }> {
  if (!data.name?.trim() || !data.email?.trim() || !data.message?.trim()) {
    throw new Error('Please fill in all fields before sending your hello.');
  }

  const payload = {
    name: data.name.trim(),
    email: data.email.trim().toLowerCase(),
    message: data.message.trim(),
  };

  // 1. Submit to server API
  try {
    await fetch('/api/say-hello', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn('Server say hello submission note:', err);
  }

  // 2. Also try Supabase if connected
  try {
    const { error } = await supabase
      .from('messages')
      .insert([
        {
          name: payload.name,
          email: payload.email,
          message: payload.message,
          type: 'say_hello',
          read: false
        }
      ]);

    if (error) {
      console.warn('Supabase say hello note:', error.message);
    }
  } catch (err) {
    console.warn('Supabase say hello handled:', err);
  }

  // 3. Save to local storage
  saveLocalMessage({
    id: 'hello-' + Date.now(),
    name: payload.name,
    email: payload.email,
    subject: 'Say Hello Note',
    message: payload.message,
    type: 'say_hello',
    read: false,
    createdAt: new Date().toISOString()
  });

  return { success: true, message: 'Your note has been received! Emioluwa reads every reader note.' };
}

// ==============================================================================
// AUTHENTICATION & ADMIN PROFILE (Connected to Supabase Auth & Profiles)
// ==============================================================================

/**
 * Log in admin using author credentials
 */
export async function loginAdmin(email: string, password: string): Promise<{ success: boolean; token: string; admin: AdminUser }> {
  const cleanEmail = email.trim().toLowerCase();

  // Strict barrier: Readers cannot log in to admin (only emioluwawrites@gmail.com accepted)
  if (cleanEmail !== 'emioluwawrites@gmail.com') {
    throw new Error('Access denied. Readers do not have access to the Admin Portal.');
  }

  // 1. Try server auth API
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password })
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
            email: 'emioluwawrites@gmail.com',
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
  } catch (err: any) {
    if (err.message && !err.message.includes('Failed to fetch') && !err.message.includes('NetworkError')) {
      throw err;
    }
  }

  // 2. Direct validation for designated credentials
  if (cleanEmail === 'emioluwawrites@gmail.com' && password === 'Emioluwa2912') {
    const fallbackToken = 'admin-session-' + Date.now();
    setAdminToken(fallbackToken);
    return {
      success: true,
      token: fallbackToken,
      admin: {
        id: 'admin-1',
        email: 'emioluwawrites@gmail.com',
        name: 'Emioluwa',
        bio: 'Young Nigerian writer, essayist, and student crafting words that connect and stories that stay.'
      }
    };
  }

  // 3. Fallback check with Supabase Auth
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: password
    });

    if (!error && data?.session && data?.user) {
      setAdminToken(data.session.access_token);
      return {
        success: true,
        token: data.session.access_token,
        admin: {
          id: data.user.id,
          email: 'emioluwawrites@gmail.com',
          name: 'Emioluwa',
          bio: 'Young Nigerian writer, essayist, and student crafting words that connect and stories that stay.'
        }
      };
    }
  } catch {
    // Handled below
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
 * Update Admin Profile & Credentials
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
// DASHBOARD STATS & ANALYTICS
// ==============================================================================

/**
 * Fetch all admin stats from Supabase
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
// ADMIN ARTICLES CRUD
// ==============================================================================

/**
 * Fetch all admin articles (published + drafts)
 */
export async function fetchAdminArticles(): Promise<Article[]> {
  const deletedSet = getDeletedArticleIds();
  let dbArticles: Article[] = [];
  try {
    const { data, error } = await supabase
      .from('articles')
      .select('*, categories(id, name, slug)')
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      dbArticles = data.map(mapArticleFromDb);
    }
  } catch (err) {
    console.warn('Could not fetch admin articles from Supabase:', err);
  }

  // Also query server database to ensure newly created or synced articles are visible
  try {
    const serverRes = await fetch('/api/articles');
    if (serverRes.ok) {
      const serverArticles: Article[] = await serverRes.json();
      if (Array.isArray(serverArticles)) {
        for (const item of serverArticles) {
          if (!dbArticles.some(a => a.id === item.id || a.slug === item.slug)) {
            dbArticles.push(item);
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // If Supabase returned articles, prioritize them as the cloud source of truth
  let combined: Article[] = [];
  if (dbArticles.length > 0) {
    combined = [...dbArticles];
  } else {
    const localArticles = getLocalArticles();
    if (localArticles.length > 0) {
      combined = [...localArticles];
    } else {
      combined = [...FALLBACK_ARTICLES];
    }
  }

  // Filter out any deleted articles
  combined = combined.filter(a => !deletedSet.has(a.id) && !deletedSet.has(a.slug));

  combined.sort((a, b) => new Date(b.createdAt || b.publishedAt).getTime() - new Date(a.createdAt || a.publishedAt).getTime());
  return combined;
}

/**
 * Helper to ensure a category exists and get its UUID
 */
async function getOrCreateCategoryId(categoryName: string): Promise<string | null> {
  const cleanName = categoryName.trim();
  const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

  try {
    const { data: existing } = await supabase
      .from('categories')
      .select('id')
      .or(`name.ilike.${cleanName},slug.eq.${slug}`)
      .maybeSingle();

    if (existing?.id) {
      return existing.id;
    }

    // Try inserting category
    const { data: newCat, error } = await supabase
      .from('categories')
      .insert([{ name: cleanName, slug, description: `${cleanName} essays & reflections` }])
      .select('id')
      .single();

    if (!error && newCat?.id) {
      return newCat.id;
    }

    const { data: firstCat } = await supabase.from('categories').select('id').limit(1).maybeSingle();
    if (firstCat?.id) return firstCat.id;
  } catch {
    // Supabase category fallback
  }

  const localMatch = getLocalCategories().find(c => c.name.toLowerCase() === cleanName.toLowerCase() || c.slug === slug);
  if (localMatch) return localMatch.id;

  const fallbackMatch = FALLBACK_CATEGORIES.find(c => c.name.toLowerCase() === cleanName.toLowerCase() || c.slug === slug);
  if (fallbackMatch) return fallbackMatch.id;

  return null;
}

/**
 * Create a new article in Supabase and server DB
 */
export async function createAdminArticle(article: Partial<Article>): Promise<Article> {
  if (!article.title?.trim() || !article.content?.trim()) {
    throw new Error('Title and content are required.');
  }

  const { data: authData } = await supabase.auth.getUser();
  const authorId = authData?.user?.id || null;

  let categoryId: string | null = null;
  try {
    categoryId = await getOrCreateCategoryId(article.category || 'Personal Growth');
  } catch {
    categoryId = null;
  }

  const slug = (article.slug || article.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');

  const newId = generateUuid();
  const now = new Date().toISOString();
  const fallbackItem: Article = {
    id: newId,
    title: article.title.trim(),
    slug: slug || `essay-${Date.now()}`,
    excerpt: article.excerpt?.trim() || article.content.substring(0, 160).replace(/[#*`_]/g, '').trim() + '...',
    content: article.content.trim(),
    category: article.category || 'Personal Growth',
    featuredImage: article.featuredImage || 'https://images.unsplash.com/photo-1455390582262-044cdead277a?q=80&w=1200&auto=format&fit=crop',
    readTime: article.readTime || `${Math.max(1, Math.ceil(article.content.split(/\s+/).length / 200))} min read`,
    status: (article.status as 'published' | 'draft') || 'published',
    publishedAt: article.publishedAt || now.split('T')[0],
    views: 0,
    createdAt: now,
    updatedAt: now
  };

  // Ensure this ID/slug is unmarked from deleted
  unmarkArticleDeleted(newId, fallbackItem.slug);

  // Immediately persist to server database
  await syncArticleToServer('upsert', fallbackItem);

const insertData: Record<string, any> = {
  id: newId,
  title: fallbackItem.title,
  slug: fallbackItem.slug,
  excerpt: fallbackItem.excerpt,
  content: fallbackItem.content,
  featured_image: fallbackItem.featuredImage,
  read_time: fallbackItem.readTime,
  status: fallbackItem.status,
  views: 0,
  published_at: fallbackItem.publishedAt,
  created_at: now,
  updated_at: now
};

if (authorId && isValidUuid(authorId)) {
  insertData.author_id = authorId;
}

if (!categoryId || !isValidUuid(categoryId)) {
  throw new Error('Could not find a valid category in Supabase.');
}

insertData.category_id = categoryId;

  try {
    const { data, error } = await supabase
      .from('articles')
      .insert([insertData])
      .select('*, categories(id, name, slug)')
      .single();

    if (error) {
      console.error('Supabase article insert error:', error);
      throw new Error(`Failed to publish article to database: ${error.message}`);
    }

    if (data) {
      const mapped = mapArticleFromDb(data);
      const locals = getLocalArticles().filter(a => a.slug !== mapped.slug && a.id !== mapped.id);
      locals.unshift(mapped);
      saveLocalArticles(locals);
      await syncArticleToServer('upsert', mapped);
      broadcastArticlesChanged('article:created');
      return mapped;
    }
  } catch (err: any) {
    console.error('Error saving to Supabase:', err);
    throw err;
  }

  // Local persistence fallback
  const locals = getLocalArticles();
  locals.unshift(fallbackItem);
  saveLocalArticles(locals);
  broadcastArticlesChanged('article:created');
  return fallbackItem;
}

/**
 * Update an existing article in Supabase
 */
export async function updateAdminArticle(id: string, article: Partial<Article>): Promise<Article> {
  const now = new Date().toISOString();
  unmarkArticleDeleted(id, article.slug);

  const locals = getLocalArticles();
  const localIdx = locals.findIndex(a => a.id === id || a.slug === id);
  const fallbackIdx = FALLBACK_ARTICLES.findIndex(a => a.id === id || a.slug === id);

  let updatedObj: Article | null = null;

  if (localIdx !== -1) {
    locals[localIdx] = { ...locals[localIdx], ...article, updatedAt: now };
    saveLocalArticles(locals);
    updatedObj = locals[localIdx];
  }

  if (fallbackIdx !== -1) {
    FALLBACK_ARTICLES[fallbackIdx] = { ...FALLBACK_ARTICLES[fallbackIdx], ...article, updatedAt: now };
    if (!updatedObj) updatedObj = FALLBACK_ARTICLES[fallbackIdx];
  }

  let targetId = id;
  if (!isValidUuid(targetId)) {
    try {
      const { data: bySlug } = await supabase.from('articles').select('id').eq('slug', id).maybeSingle();
      if (bySlug?.id) targetId = bySlug.id;
    } catch {
      // Ignore
    }
  }

  if (isValidUuid(targetId)) {
    const updates: Record<string, any> = {};
    if (article.title) updates.title = article.title.trim();
    if (article.slug) updates.slug = article.slug.trim();
    if (article.excerpt !== undefined) updates.excerpt = article.excerpt;
    if (article.content !== undefined) updates.content = article.content;
    if (article.featuredImage) updates.featured_image = article.featuredImage;
    if (article.readTime) updates.read_time = article.readTime;
    if (article.status) updates.status = article.status;
    if (article.publishedAt) updates.published_at = article.publishedAt;

    if (article.category) {
      try {
        const catId = await getOrCreateCategoryId(article.category);
        if (catId && isValidUuid(catId)) updates.category_id = catId;
      } catch {
        // Ignore
      }
    }

    try {
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

      if (data) {
        const mapped = mapArticleFromDb(data);
        const locals = getLocalArticles().filter(a => a.id !== mapped.id && a.slug !== mapped.slug);
        locals.unshift(mapped);
        saveLocalArticles(locals);
        syncArticleToServer('upsert', mapped);
        broadcastArticlesChanged('article:updated');
        return mapped;
      }
    } catch (err: any) {
      console.error('Update in Supabase error:', err);
      throw err;
    }
  }

  if (updatedObj) {
    syncArticleToServer('upsert', updatedObj);
  }
  broadcastArticlesChanged('article:updated');
  if (updatedObj) {
    return updatedObj;
  }

  const fallbackCreated: Article = {
    id: id,
    title: article.title || 'Untitled Essay',
    slug: article.slug || `essay-${Date.now()}`,
    excerpt: article.excerpt || '',
    content: article.content || '',
    category: article.category || 'Personal Growth',
    featuredImage: article.featuredImage || 'https://images.unsplash.com/photo-1455390582262-044cdead277a?q=80&w=1200&auto=format&fit=crop',
    readTime: article.readTime || '4 min read',
    status: (article.status as 'published' | 'draft') || 'published',
    publishedAt: article.publishedAt || now.split('T')[0],
    views: 0,
    createdAt: now,
    updatedAt: now
  };
  locals.unshift(fallbackCreated);
  saveLocalArticles(locals);
  syncArticleToServer('upsert', fallbackCreated);
  return fallbackCreated;
}

/**
 * Toggle article status between draft and published
 */
export async function toggleArticleStatus(id: string): Promise<Article> {
  const now = new Date().toISOString();
  const locals = getLocalArticles();
  const localItem = locals.find(a => a.id === id || a.slug === id);
  const fallbackItem = FALLBACK_ARTICLES.find(a => a.id === id || a.slug === id);

  if (localItem) {
    localItem.status = localItem.status === 'published' ? 'draft' : 'published';
    localItem.updatedAt = now;
    saveLocalArticles(locals);
  }

  if (fallbackItem) {
    fallbackItem.status = fallbackItem.status === 'published' ? 'draft' : 'published';
    fallbackItem.updatedAt = now;
  }

  let targetId = id;
  if (!isValidUuid(targetId)) {
    try {
      const { data: bySlug } = await supabase.from('articles').select('id, status').eq('slug', id).maybeSingle();
      if (bySlug?.id) targetId = bySlug.id;
    } catch {
      // Ignore
    }
  }

  if (isValidUuid(targetId)) {
    try {
      const { data: current } = await supabase.from('articles').select('status').eq('id', targetId).maybeSingle();
      if (current) {
        const nextStatus = current.status === 'published' ? 'draft' : 'published';
        const { data, error } = await supabase
          .from('articles')
          .update({ status: nextStatus })
          .eq('id', targetId)
          .select('*, categories(id, name, slug)')
          .single();

        if (!error && data) {
          const mapped = mapArticleFromDb(data);
          syncArticleToServer('upsert', mapped);
          broadcastArticlesChanged('article:toggled');
          return mapped;
        }
      }
    } catch (err) {
      console.warn('Toggle in Supabase handled gracefully:', err);
    }
  }

  if (localItem) {
    syncArticleToServer('upsert', localItem);
  } else if (fallbackItem) {
    syncArticleToServer('upsert', fallbackItem);
  }
  broadcastArticlesChanged('article:toggled');
  if (localItem) return { ...localItem };
  if (fallbackItem) return { ...fallbackItem };
  throw new Error('Article not found');
}

/**
 * Delete an article from Supabase and mark deleted
 */
export async function deleteAdminArticle(id: string): Promise<void> {
  // Find article to get both ID and slug for thorough filtering
  const allKnown = [...getLocalArticles(), ...FALLBACK_ARTICLES];
  const found = allKnown.find(a => a.id === id || a.slug === id);
  if (found) {
    markArticleDeleted(found.id, found.slug);
    syncArticleToServer('delete', undefined, found.id);
    syncArticleToServer('delete', undefined, found.slug);
  } else {
    markArticleDeleted(id);
    syncArticleToServer('delete', undefined, id);
  }

  // Remove from local articles
  const locals = getLocalArticles().filter(a => a.id !== id && a.slug !== id);
  saveLocalArticles(locals);

  // Remove from fallback array
  const fallbackIndex = FALLBACK_ARTICLES.findIndex(a => a.id === id || a.slug === id);
  if (fallbackIndex !== -1) {
    FALLBACK_ARTICLES.splice(fallbackIndex, 1);
  }

  try {
    let deleteResult: any = null;
    if (isValidUuid(id)) {
      deleteResult = await supabase.from('articles').delete().eq('id', id);
    } else {
      deleteResult = await supabase.from('articles').delete().eq('slug', id);
    }
    if (deleteResult?.error) {
      console.error('Delete in Supabase error:', deleteResult.error);
    }
  } catch (err) {
    console.error('Delete in Supabase failed:', err);
  }

  // Broadcast real-time deletion event across app
  broadcastArticlesChanged('article:deleted');
}

// ==============================================================================
// FILE & MEDIA UPLOADS (Supabase Storage + Mammoth DOCX)
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
 * Upload image to Supabase Storage bucket 'article-covers'
 */
export async function uploadImageFile(file: File): Promise<{ success: boolean; url: string }> {
  try {
    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${fileExt}`;
    const filePath = `covers/${fileName}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('article-covers')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.warn('Supabase storage bucket upload error, converting to local preview URL:', uploadError.message);
      // If storage bucket is not created or public yet, fallback to base64 Data URL so the user is never blocked!
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ success: true, url: reader.result as string });
        reader.onerror = () => reject(new Error('Failed to read image file'));
        reader.readAsDataURL(file);
      });
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('article-covers')
      .getPublicUrl(filePath);

    return {
      success: true,
      url: publicUrlData.publicUrl
    };
  } catch (err: any) {
    // Fallback to FileReader DataURL
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ success: true, url: reader.result as string });
      reader.onerror = () => resolve({ success: true, url: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?q=80&w=1200&auto=format&fit=crop' });
      reader.readAsDataURL(file);
    });
  }
}

// ==============================================================================
// CATEGORIES CRUD
// ==============================================================================

/**
 * Create a new Category
 */
export async function createAdminCategory(data: { name: string; description?: string }): Promise<Category> {
  if (!data.name?.trim()) {
    throw new Error('Category name is required.');
  }

  const cleanName = data.name.trim();
  const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
  const newId = generateUuid();
  const fallbackCat: Category = {
    id: newId,
    name: cleanName,
    slug: slug || `category-${Date.now()}`,
    description: data.description?.trim() || '',
    articleCount: 0
  };

  // Unmark if previously deleted
  unmarkCategoryDeleted(newId, fallbackCat.slug);
  unmarkCategoryDeleted(cleanName.toLowerCase());

  // 1. Persist to Supabase
  try {
    const { data: cat, error } = await supabase
      .from('categories')
      .insert([
        {
          id: newId,
          name: fallbackCat.name,
          slug: fallbackCat.slug,
          description: fallbackCat.description
        }
      ])
      .select('*')
      .single();

    if (!error && cat) {
      const mapped = mapCategoryFromDb(cat);
      const locals = getLocalCategories().filter(c => c.id !== mapped.id && c.slug !== mapped.slug);
      locals.push(mapped);
      saveLocalCategories(locals);
      broadcastArticlesChanged('category:created');
      return mapped;
    }
  } catch (err) {
    console.warn('Supabase category creation note:', err);
  }

  // 2. Sync to Backend server
  try {
    const token = getAdminToken();
    await fetch('/api/admin/categories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ name: fallbackCat.name, description: fallbackCat.description })
    });
  } catch (err) {
    console.warn('Backend category creation note:', err);
  }

  const locals = getLocalCategories().filter(c => c.id !== fallbackCat.id && c.slug !== fallbackCat.slug);
  locals.push(fallbackCat);
  saveLocalCategories(locals);

  const existingFb = FALLBACK_CATEGORIES.findIndex(c => c.id === fallbackCat.id || c.slug === fallbackCat.slug);
  if (existingFb === -1) {
    FALLBACK_CATEGORIES.push(fallbackCat);
  } else {
    FALLBACK_CATEGORIES[existingFb] = fallbackCat;
  }

  broadcastArticlesChanged('category:created');
  return fallbackCat;
}

/**
 * Update Category
 */
export async function updateAdminCategory(id: string, data: { name?: string; description?: string }): Promise<Category> {
  const allCats = await fetchCategories();
  const existing = allCats.find(c => c.id === id || c.slug === id || (data.name && c.name.toLowerCase() === data.name.toLowerCase()));
  const oldName = existing?.name || '';
  const newName = (data.name?.trim()) || oldName || 'General';
  const newSlug = newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
  const newDesc = data.description !== undefined ? data.description.trim() : (existing?.description || '');

  const updatedObj: Category = {
    id: existing?.id || id,
    name: newName,
    slug: newSlug || `category-${Date.now()}`,
    description: newDesc,
    articleCount: existing?.articleCount || 0
  };

  // Unmark from deleted set
  unmarkCategoryDeleted(updatedObj.id, updatedObj.slug);
  unmarkCategoryDeleted(newName.toLowerCase());

  // Save in client modified registry
  saveModifiedCategory(updatedObj.id, updatedObj);
  saveModifiedCategory(updatedObj.slug, updatedObj);
  saveModifiedCategory(id, updatedObj);
  if (existing?.slug) saveModifiedCategory(existing.slug, updatedObj);
  if (oldName) saveModifiedCategory(oldName.toLowerCase(), updatedObj);

  // Update in local storage
  const locals = getLocalCategories();
  const localIdx = locals.findIndex(c => c.id === updatedObj.id || c.slug === updatedObj.slug || c.id === id || (existing && c.slug === existing.slug));
  if (localIdx !== -1) {
    locals[localIdx] = { ...locals[localIdx], ...updatedObj };
  } else {
    locals.push(updatedObj);
  }
  saveLocalCategories(locals);

  // Update in fallback categories
  const fallbackIndex = FALLBACK_CATEGORIES.findIndex(c => c.id === updatedObj.id || c.slug === updatedObj.slug || c.id === id || (existing && c.slug === existing.slug));
  if (fallbackIndex !== -1) {
    FALLBACK_CATEGORIES[fallbackIndex] = { ...FALLBACK_CATEGORIES[fallbackIndex], ...updatedObj };
  }

  // 1. Update in Supabase
  try {
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString()
    };
    if (data.name?.trim()) {
      updates.name = newName;
      updates.slug = newSlug;
    }
    if (data.description !== undefined) {
      updates.description = newDesc;
    }

    if (isValidUuid(updatedObj.id)) {
      await supabase
        .from('categories')
        .update(updates)
        .eq('id', updatedObj.id);
    }
    if (existing?.slug) {
      await supabase
        .from('categories')
        .update(updates)
        .eq('slug', existing.slug);
    }
    await supabase
      .from('categories')
      .update(updates)
      .eq('slug', newSlug);
  } catch (err) {
    console.warn('Supabase category update note:', err);
  }

  // 2. Sync with Backend Server
  try {
    const token = getAdminToken();
    await fetch(`/api/admin/categories/${encodeURIComponent(updatedObj.id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        name: newName,
        description: newDesc,
        oldName: oldName
      })
    });
  } catch (err) {
    console.warn('Backend category sync note:', err);
  }

  // 3. Update articles that used old category name
  if (oldName && oldName.toLowerCase() !== newName.toLowerCase()) {
    try {
      const currentArticles = getLocalArticles();
      let articlesChanged = false;
      const updatedArticles = currentArticles.map(a => {
        if (a.category.toLowerCase() === oldName.toLowerCase()) {
          articlesChanged = true;
          return { ...a, category: newName };
        }
        return a;
      });
      if (articlesChanged) {
        saveLocalArticles(updatedArticles);
      }
    } catch {
      // Ignore
    }
  }

  broadcastArticlesChanged('category:updated');
  return updatedObj;
}

/**
 * Delete Category permanently
 */
export async function deleteAdminCategory(id: string): Promise<void> {
  const allCats = await fetchCategories();
  const catToDelete = allCats.find(c => c.id === id || c.slug === id || c.name.toLowerCase() === id.toLowerCase());
  const targetId = catToDelete?.id || id;
  const targetSlug = catToDelete?.slug || id;
  const targetName = catToDelete?.name || '';

  // 1. Mark as permanently deleted so it's filtered everywhere in the app
  markCategoryDeleted(targetId);
  markCategoryDeleted(targetSlug);
  if (targetName) {
    markCategoryDeleted(targetName.toLowerCase());
  }

  // 2. Remove from modified categories registry
  removeModifiedCategory(targetId);
  removeModifiedCategory(targetSlug);
  if (targetName) {
    removeModifiedCategory(targetName.toLowerCase());
  }

  // 3. Remove from local storage
  const locals = getLocalCategories().filter(c => 
    c.id !== targetId && 
    c.slug !== targetSlug && 
    c.id !== id && 
    c.slug !== id &&
    (!targetName || c.name.toLowerCase() !== targetName.toLowerCase())
  );
  saveLocalCategories(locals);

  // 4. Remove from memory fallback list
  const fallbackIndex = FALLBACK_CATEGORIES.findIndex(c => 
    c.id === targetId || 
    c.slug === targetSlug || 
    c.id === id || 
    c.slug === id ||
    (targetName && c.name.toLowerCase() === targetName.toLowerCase())
  );
  if (fallbackIndex !== -1) {
    FALLBACK_CATEGORIES.splice(fallbackIndex, 1);
  }

  // 5. Permanently delete from Supabase
  try {
    if (isValidUuid(targetId)) {
      await supabase.from('categories').delete().eq('id', targetId);
    }
    if (targetSlug) {
      await supabase.from('categories').delete().eq('slug', targetSlug);
    }
    if (targetName) {
      await supabase.from('categories').delete().eq('name', targetName);
    }
  } catch (err) {
    console.warn('Supabase category deletion handled:', err);
  }

  // 6. Permanently delete from backend server
  try {
    const token = getAdminToken();
    const query = targetName ? `?name=${encodeURIComponent(targetName)}` : '';
    await fetch(`/api/admin/categories/${encodeURIComponent(targetId)}${query}`, {
      method: 'DELETE',
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    });
  } catch (err) {
    console.warn('Backend category deletion handled:', err);
  }

  broadcastArticlesChanged('category:deleted');
}

// ==============================================================================
// MESSAGES & INBOX CRUD (Connected to Database & Server)
// ==============================================================================

/**
 * Fetch all reader inbox messages
 */
export async function fetchAdminMessages(): Promise<Message[]> {
  const deletedSet = getDeletedMessageIds();
  const readSet = getReadMessageIds();
  const token = getAdminToken();
  const allMap = new Map<string, Message>();

  // 1. Query server backend API (persisted in data/db.json)
  try {
    const res = await fetch('/api/admin/messages', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (res.ok) {
      const data: Message[] = await res.json();
      if (Array.isArray(data)) {
        for (const msg of data) {
          if (!deletedSet.has(msg.id)) {
            if (readSet.has(msg.id)) {
              msg.read = true;
            }
            allMap.set(msg.id, msg);
          }
        }
      }
    }
  } catch (err) {
    console.warn('Could not fetch messages from server API:', err);
  }

  // 2. Query Supabase messages table if connected
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*, message_replies(*)')
      .order('created_at', { ascending: false });

    if (!error && data && Array.isArray(data)) {
      for (const raw of data) {
        const mapped = mapMessageFromDb(raw);
        if (readSet.has(mapped.id)) {
          mapped.read = true;
        }
        if (!deletedSet.has(mapped.id) && !allMap.has(mapped.id)) {
          allMap.set(mapped.id, mapped);
        }
      }
    }
  } catch (err) {
    console.warn('Supabase fetch messages error:', err);
  }

  // 3. Include local messages cache
  const localList = getLocalMessages();
  for (const msg of localList) {
    if (readSet.has(msg.id)) {
      msg.read = true;
    }
    if (!deletedSet.has(msg.id) && !allMap.has(msg.id)) {
      allMap.set(msg.id, msg);
    }
  }

  const result = Array.from(allMap.values());
  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return result;
}

/**
 * Mark a message as read or unread (connected to database)
 */
export async function toggleMessageRead(id: string, read?: boolean, messageData?: Partial<Message>): Promise<Message> {
  const token = getAdminToken();
  const newStatus = read !== undefined ? Boolean(read) : true;

  if (newStatus) {
    addReadMessageId(id);
  } else {
    removeReadMessageId(id);
  }

  let updatedMessage: Message | null = null;

  // 1. Update in server database
  try {
    const res = await fetch(`/api/admin/messages/${encodeURIComponent(id)}/read`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        read: newStatus,
        ...messageData
      })
    });
    if (res.ok) {
      updatedMessage = await res.json();
    }
  } catch (err) {
    console.warn('Server toggleMessageRead error:', err);
  }

  // 2. Update in Supabase (all messages)
  try {
    const { data, error } = await supabase
      .from('messages')
      .update({ read: newStatus })
      .eq('id', id)
      .select('*, message_replies(*)')
      .single();
    if (!error && data) {
      updatedMessage = mapMessageFromDb(data);
    }
  } catch (err) {
    console.warn('Supabase toggleMessageRead error:', err);
  }

  // 3. Fallback object if needed
  if (!updatedMessage) {
    updatedMessage = {
      id,
      name: messageData?.name || 'Reader',
      email: messageData?.email || 'reader@example.com',
      subject: messageData?.subject || 'Website Note',
      message: messageData?.message || '',
      type: messageData?.type || 'contact',
      read: newStatus,
      createdAt: messageData?.createdAt || new Date().toISOString(),
      replies: messageData?.replies || []
    };
  } else {
    updatedMessage.read = newStatus;
  }

  // 4. Update local cache
  saveLocalMessage(updatedMessage);
  broadcastArticlesChanged('message:updated');

  return updatedMessage;
}

/**
 * Send author reply to reader message (connected to database)
 */
export async function replyToMessage(id: string, text: string): Promise<{ success: boolean; reply: any }> {
  if (!text?.trim()) {
    throw new Error('Reply text cannot be empty.');
  }

  const token = getAdminToken();
  let createdReply: any = null;

  // 1. Submit to server database
  try {
    const res = await fetch(`/api/admin/messages/${encodeURIComponent(id)}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ text: text.trim() })
    });
    if (res.ok) {
      const json = await res.json();
      createdReply = json.reply;
    }
  } catch (err) {
    console.warn('Server reply error:', err);
  }

  // 2. Submit to Supabase if valid UUID
  if (isValidUuid(id)) {
    try {
      const { data: authData } = await supabase.auth.getUser();
      const authorId = authData?.user?.id || null;

      const { data, error } = await supabase
        .from('message_replies')
        .insert([
          {
            message_id: id,
            author_id: authorId,
            reply_text: text.trim()
          }
        ])
        .select('*')
        .single();

      if (!error && data) {
        createdReply = {
          id: data.id,
          text: data.reply_text,
          sentAt: data.created_at
        };
      }

      await supabase.from('messages').update({ read: true }).eq('id', id);
    } catch (err) {
      console.warn('Supabase reply error:', err);
    }
  }

  if (!createdReply) {
    createdReply = {
      id: 'reply-' + Date.now(),
      text: text.trim(),
      sentAt: new Date().toISOString()
    };
  }

  // Update local message state
  const locals = getLocalMessages();
  const existing = locals.find(m => m.id === id);
  if (existing) {
    existing.read = true;
    if (!existing.replies) existing.replies = [];
    existing.replies.push(createdReply);
    saveLocalMessage(existing);
  }

  broadcastArticlesChanged('message:replied');

  return {
    success: true,
    reply: createdReply
  };
}

/**
 * Delete a message from reader inbox (connected to database)
 */
export async function deleteAdminMessage(id: string): Promise<void> {
  const token = getAdminToken();

  // 1. Immediately mark deleted locally
  addDeletedMessageId(id);
  removeReadMessageId(id);
  removeLocalMessage(id);

  // 2. Delete from server database (data/db.json)
  try {
    await fetch(`/api/admin/messages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
  } catch (err) {
    console.warn('Server deleteAdminMessage error:', err);
  }

  // 3. Delete from Supabase if valid UUID
  if (isValidUuid(id)) {
    try {
      await supabase
        .from('message_replies')
        .delete()
        .eq('message_id', id);
    } catch {}

    try {
      await supabase
        .from('messages')
        .delete()
        .eq('id', id);
    } catch (err) {
      console.warn('Supabase deleteAdminMessage error:', err);
    }
  }

  broadcastArticlesChanged('message:deleted');
}
