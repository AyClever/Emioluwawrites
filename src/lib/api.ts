import { useState, useEffect } from 'react';
import { Article, Category, Message, AdminUser, AdminStats } from '../types';
import { supabase, isSupabaseConfigured, isSupabaseReachable } from './supabase';
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

/**
 * Universal API helper for server backend endpoints
 */
async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {})
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(endpoint, { ...options, headers });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Server request failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
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
 * Subscribe to real-time changes to articles, categories, and messages
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

  // Supabase PostgreSQL Realtime subscription (only if Supabase is configured)
  let realtimeChannel: any = null;
  if (isSupabaseConfigured) {
    try {
      const channelId = `realtime-desk-${Math.random().toString(36).substring(2, 9)}`;
      realtimeChannel = supabase
        .channel(channelId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'articles' }, () => callback())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => callback())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => callback())
        .subscribe();
    } catch (err) {
      console.warn('Realtime subscription not active:', err);
    }
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
    if (realtimeChannel && isSupabaseConfigured) {
      try {
        supabase.removeChannel(realtimeChannel);
      } catch {
        // Ignore
      }
    }
  };
}

// ==============================================================================
// PUBLIC ENDPOINTS (Dual-engine: Server DB + Supabase sync)
// ==============================================================================

/**
 * Fetch all published articles
 */
export async function fetchPublishedArticles(params?: { category?: string; search?: string; limit?: number }): Promise<Article[]> {
  try {
    // 1. Fetch from server backend API (always reliable and instant)
    const queryParts: string[] = [];
    if (params?.category && params.category !== 'All') {
      queryParts.push(`category=${encodeURIComponent(params.category)}`);
    }
    if (params?.search && params.search.trim()) {
      queryParts.push(`search=${encodeURIComponent(params.search.trim())}`);
    }
    if (params?.limit) {
      queryParts.push(`limit=${params.limit}`);
    }

    const qs = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
    const serverArticles = await apiFetch<Article[]>(`/api/articles${qs}`);
    if (Array.isArray(serverArticles)) {
      return serverArticles;
    }
  } catch (serverErr) {
    console.warn('Server articles fetch note:', serverErr);
  }

  // 2. Fallback to Supabase if reachable
  const reachable = await isSupabaseReachable();
  if (reachable) {
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
      if (!error && data) {
        let articles: Article[] = data.map((row: any) => ({
          id: row.id,
          slug: row.slug,
          title: row.title,
          excerpt: row.excerpt || '',
          content: row.content || '',
          category: row.categories?.name || row.category || 'General',
          featuredImage: row.featured_image || 'https://images.unsplash.com/photo-1455390582262-044cdead277a?q=80&w=1200&auto=format&fit=crop',
          readTime: row.read_time || '4 min read',
          publishedAt: row.published_at || (row.created_at ? row.created_at.split('T')[0] : '2026-08-20'),
          status: (row.status === 'published' ? 'published' : 'draft') as 'draft' | 'published',
          views: typeof row.views === 'number' ? row.views : 0,
          createdAt: row.created_at || new Date().toISOString(),
          updatedAt: row.updated_at || new Date().toISOString(),
        }));

        if (params?.category && params.category !== 'All') {
          const target = params.category.toLowerCase();
          articles = articles.filter(a => a.category.toLowerCase() === target);
        }

        return articles;
      }
    } catch (supErr) {
      console.warn('Supabase fallback note:', supErr);
    }
  }

  return [];
}

/**
 * Fetch a single article by slug
 */
export async function fetchArticleBySlug(slug: string): Promise<{ article: Article; related: Article[] }> {
  try {
    const res = await apiFetch<{ article: Article; related?: Article[] }>(`/api/articles/${encodeURIComponent(slug)}`);
    if (res?.article) {
      return {
        article: res.article,
        related: res.related || []
      };
    }
  } catch (serverErr) {
    console.warn('Server article by slug note:', serverErr);
  }

  // Fallback to Supabase if reachable
  const reachable = await isSupabaseReachable();
  if (reachable) {
    try {
      const { data, error } = await supabase
        .from('articles')
        .select('*, categories(id, name, slug)')
        .eq('slug', slug)
        .maybeSingle();

      if (!error && data) {
        const article: Article = {
          id: data.id,
          slug: data.slug,
          title: data.title,
          excerpt: data.excerpt || '',
          content: data.content || '',
          category: data.categories?.name || data.category || 'General',
          featuredImage: data.featured_image || 'https://images.unsplash.com/photo-1455390582262-044cdead277a?q=80&w=1200&auto=format&fit=crop',
          readTime: data.read_time || '4 min read',
          publishedAt: data.published_at || (data.created_at ? data.created_at.split('T')[0] : '2026-08-20'),
          status: data.status as 'draft' | 'published',
          views: (data.views || 0) + 1,
          createdAt: data.created_at || new Date().toISOString(),
          updatedAt: data.updated_at || new Date().toISOString(),
        };

        return { article, related: [] };
      }
    } catch (supErr) {
      console.warn('Supabase fetchArticleBySlug note:', supErr);
    }
  }

  throw new Error('Article not found');
}

/**
 * Fetch all categories
 */
export async function fetchCategories(): Promise<Category[]> {
  try {
    const serverCategories = await apiFetch<Category[]>('/api/categories');
    if (Array.isArray(serverCategories)) {
      return serverCategories;
    }
  } catch (serverErr) {
    console.warn('Server categories fetch note:', serverErr);
  }

  const reachable = await isSupabaseReachable();
  if (reachable) {
    try {
      const { data, error } = await supabase.from('categories').select('*').order('name', { ascending: true });
      if (!error && data) {
        return data.map((c: any) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          description: c.description || '',
          articleCount: 0
        }));
      }
    } catch (supErr) {
      console.warn('Supabase fetchCategories note:', supErr);
    }
  }

  return [];
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

  // 1. Submit to server backend
  const res = await apiFetch<{ success: boolean; message: string }>('/api/contact', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  // 2. Dual-persist to Supabase if reachable
  const reachable = await isSupabaseReachable();
  if (reachable) {
    try {
      await supabase.from('messages').insert([{
        id: generateUuid(),
        name: payload.name,
        email: payload.email,
        subject: payload.subject,
        message: payload.message,
        type: 'contact',
        read: false,
        created_at: new Date().toISOString()
      }]);
    } catch (supErr) {
      console.warn('Supabase background message sync note:', supErr);
    }
  }

  broadcastArticlesChanged('message:received');
  return res;
}

/**
 * Submit Say Hello Note
 */
export async function submitSayHello(data: { name: string; email: string; message: string }): Promise<{ success: boolean; message: string }> {
  if (!data.name?.trim() || !data.email?.trim() || !data.message?.trim()) {
    throw new Error('Please provide your name, email, and message.');
  }

  const payload = {
    name: data.name.trim(),
    email: data.email.trim().toLowerCase(),
    message: data.message.trim(),
  };

  const res = await apiFetch<{ success: boolean; message: string }>('/api/say-hello', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  const reachable = await isSupabaseReachable();
  if (reachable) {
    try {
      await supabase.from('messages').insert([{
        id: generateUuid(),
        name: payload.name,
        email: payload.email,
        subject: 'Say Hello Note',
        message: payload.message,
        type: 'say_hello',
        read: false,
        created_at: new Date().toISOString()
      }]);
    } catch (supErr) {
      console.warn('Supabase background say-hello sync note:', supErr);
    }
  }

  broadcastArticlesChanged('message:received');
  return res;
}

// ==============================================================================
// AUTHENTICATION & AUTHOR PROFILE
// ==============================================================================

export const AUTHORIZED_ADMIN_EMAIL = 'emioluwawrites@gmail.com';

export interface AuthorProfile {
  name: string;
  bio: string;
  email: string;
  avatar_url?: string | null;
}

let cachedAuthorProfile: AuthorProfile = {
  name: 'Emioluwa',
  bio: 'Young Nigerian writer, essayist, and student crafting words that connect and stories that stay.',
  email: 'emioluwawrites@gmail.com'
};

const authorProfileListeners = new Set<(profile: AuthorProfile) => void>();

export function subscribeToAuthorProfile(listener: (profile: AuthorProfile) => void): () => void {
  authorProfileListeners.add(listener);
  listener(cachedAuthorProfile);
  return () => {
    authorProfileListeners.delete(listener);
  };
}

export async function fetchAuthorProfile(): Promise<AuthorProfile> {
  try {
    const res = await apiFetch<AuthorProfile>('/api/author-profile');
    if (res?.name) {
      cachedAuthorProfile = {
        name: res.name || cachedAuthorProfile.name,
        bio: res.bio || cachedAuthorProfile.bio,
        email: res.email || cachedAuthorProfile.email,
        avatar_url: res.avatar_url || cachedAuthorProfile.avatar_url
      };
      authorProfileListeners.forEach(cb => cb(cachedAuthorProfile));
      return cachedAuthorProfile;
    }
  } catch {
    // Ignore server profile fetch error
  }

  const reachable = await isSupabaseReachable();
  if (reachable) {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, bio, email, avatar_url')
        .eq('role', 'admin')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (profile) {
        cachedAuthorProfile = {
          name: profile.name || cachedAuthorProfile.name,
          bio: profile.bio || cachedAuthorProfile.bio,
          email: profile.email || cachedAuthorProfile.email,
          avatar_url: profile.avatar_url
        };
        authorProfileListeners.forEach(cb => cb(cachedAuthorProfile));
      }
    } catch {}
  }

  return cachedAuthorProfile;
}

export function useAuthorProfile(): AuthorProfile {
  const [profile, setProfile] = useState<AuthorProfile>(cachedAuthorProfile);

  useEffect(() => {
    fetchAuthorProfile().then(setProfile);
    const unsubscribe = subscribeToAuthorProfile(setProfile);
    return unsubscribe;
  }, []);

  return profile;
}

/**
 * Log in admin using author credentials
 */
export async function loginAdmin(email: string, password: string): Promise<{ success: boolean; token: string; admin: AdminUser }> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanPass = password.trim();

  // 1. Authenticate with server API
  const res = await apiFetch<{ success: boolean; token: string; admin: AdminUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: cleanEmail, password: cleanPass })
  });

  if (res?.token) {
    setAdminToken(res.token);

    // Sync profile cache
    cachedAuthorProfile = {
      name: res.admin.name || 'Emioluwa',
      bio: res.admin.bio || cachedAuthorProfile.bio,
      email: res.admin.email || cleanEmail
    };
    authorProfileListeners.forEach(cb => cb(cachedAuthorProfile));

    // Also attempt Supabase sign-in in background if reachable
    const reachable = await isSupabaseReachable();
    if (reachable) {
      try {
        await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPass
        });
      } catch (supErr) {
        console.warn('Supabase secondary login sync note:', supErr);
      }
    }

    return res;
  }

  throw new Error('Authentication failed');
}

/**
 * Fetch currently authenticated admin user
 */
export async function fetchAdminMe(): Promise<AdminUser> {
  const token = getAdminToken();
  if (!token) {
    throw new Error('No active admin session found');
  }

  try {
    const admin = await apiFetch<AdminUser>('/api/admin/me');
    if (admin) {
      cachedAuthorProfile = {
        name: admin.name || cachedAuthorProfile.name,
        bio: admin.bio || cachedAuthorProfile.bio,
        email: admin.email || cachedAuthorProfile.email
      };
      authorProfileListeners.forEach(cb => cb(cachedAuthorProfile));
      return admin;
    }
  } catch (err: any) {
    removeAdminToken();
    throw new Error(err.message || 'Session expired. Please log in again.');
  }

  throw new Error('Unable to verify session');
}

/**
 * Log out admin
 */
export async function logoutAdmin(): Promise<void> {
  try {
    const reachable = await isSupabaseReachable();
    if (reachable) {
      await supabase.auth.signOut();
    }
  } catch {
    // Ignore
  } finally {
    removeAdminToken();
  }
}

export interface UpdateAdminProfileInput {
  name?: string;
  bio?: string;
  email?: string;
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

/**
 * Update Admin Profile & Credentials
 */
export async function updateAdminProfile(data: UpdateAdminProfileInput): Promise<{
  success: boolean;
  admin: AdminUser;
  message: string;
}> {
  if (data.newPassword) {
    if (!data.currentPassword) {
      throw new Error('Current password is required to set a new password.');
    }
    if (data.newPassword !== data.confirmPassword) {
      throw new Error('New password and confirmation password do not match.');
    }
    if (data.newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters long.');
    }
  }

  // 1. Update on server backend
  const res = await apiFetch<{ success: boolean; admin: AdminUser; message: string }>('/api/admin/profile', {
    method: 'PUT',
    body: JSON.stringify(data)
  });

  // 2. Update cached author profile
  cachedAuthorProfile = {
    ...cachedAuthorProfile,
    name: res.admin.name || cachedAuthorProfile.name,
    bio: res.admin.bio || cachedAuthorProfile.bio,
    email: res.admin.email || cachedAuthorProfile.email
  };
  authorProfileListeners.forEach(cb => cb(cachedAuthorProfile));

  // 3. Dual-persist to Supabase if reachable
  const reachable = await isSupabaseReachable();
  if (reachable) {
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (authData?.user) {
        if (data.newPassword) {
          await supabase.auth.updateUser({ password: data.newPassword });
        }
        if (data.email) {
          await supabase.auth.updateUser({ email: data.email.trim().toLowerCase() });
        }
        await supabase
          .from('profiles')
          .update({
            name: res.admin.name,
            bio: res.admin.bio,
            email: res.admin.email,
            updated_at: new Date().toISOString()
          })
          .eq('id', authData.user.id);
      }
    } catch (supErr) {
      console.warn('Supabase profile dual-sync note:', supErr);
    }
  }

  broadcastArticlesChanged('profile:updated');
  return res;
}

// ==============================================================================
// DASHBOARD STATS & ANALYTICS
// ==============================================================================

export async function recordWebsiteVisitor(): Promise<void> {
  const VISITOR_KEY = 'emioluwa_visitor_counted';
  if (typeof window === 'undefined') return;
  if (localStorage.getItem(VISITOR_KEY)) return;
  localStorage.setItem(VISITOR_KEY, 'true');

  const reachable = await isSupabaseReachable();
  if (reachable) {
    try {
      await supabase.from('website_views').insert([{
        visitor_id: generateUuid(),
        created_at: new Date().toISOString()
      }]);
    } catch {}
  }
}

export async function fetchWebsiteVisitorsCount(): Promise<number> {
  try {
    const stats = await apiFetch<AdminStats>('/api/admin/stats');
    return stats.totalViews || 0;
  } catch {
    return 0;
  }
}

export async function fetchAdminStats(): Promise<AdminStats> {
  return apiFetch<AdminStats>('/api/admin/stats');
}

// ==============================================================================
// ADMIN ARTICLES CRUD
// ==============================================================================

export async function fetchAdminArticles(): Promise<Article[]> {
  return apiFetch<Article[]>('/api/admin/articles');
}

export async function createAdminArticle(article: Partial<Article>): Promise<Article> {
  if (!article.title?.trim() || !article.content?.trim() || !article.category?.trim()) {
    throw new Error('Title, content, and category are required.');
  }

  const created = await apiFetch<Article>('/api/admin/articles', {
    method: 'POST',
    body: JSON.stringify(article)
  });

  // Dual sync to Supabase if reachable
  const reachable = await isSupabaseReachable();
  if (reachable) {
    try {
      await supabase.from('articles').insert([{
        id: generateUuid(),
        title: created.title,
        slug: created.slug,
        excerpt: created.excerpt,
        content: created.content,
        category: created.category,
        featured_image: created.featuredImage,
        read_time: created.readTime,
        status: created.status,
        published_at: created.publishedAt,
        views: created.views || 0,
        created_at: created.createdAt,
        updated_at: created.updatedAt
      }]);
    } catch (supErr) {
      console.warn('Supabase article sync note:', supErr);
    }
  }

  broadcastArticlesChanged('article:created');
  return created;
}

export async function updateAdminArticle(id: string, article: Partial<Article>): Promise<Article> {
  const updated = await apiFetch<Article>(`/api/admin/articles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(article)
  });

  const reachable = await isSupabaseReachable();
  if (reachable) {
    try {
      await supabase
        .from('articles')
        .update({
          title: updated.title,
          slug: updated.slug,
          excerpt: updated.excerpt,
          content: updated.content,
          category: updated.category,
          featured_image: updated.featuredImage,
          read_time: updated.readTime,
          status: updated.status,
          published_at: updated.publishedAt,
          updated_at: updated.updatedAt
        })
        .or(`id.eq.${id},slug.eq.${id}`);
    } catch (supErr) {
      console.warn('Supabase article update sync note:', supErr);
    }
  }

  broadcastArticlesChanged('article:updated');
  return updated;
}

export async function toggleArticleStatus(id: string): Promise<Article> {
  const updated = await apiFetch<Article>(`/api/admin/articles/${encodeURIComponent(id)}/toggle-status`, {
    method: 'POST'
  });

  const reachable = await isSupabaseReachable();
  if (reachable) {
    try {
      await supabase
        .from('articles')
        .update({ status: updated.status, updated_at: updated.updatedAt })
        .or(`id.eq.${id},slug.eq.${id}`);
    } catch {}
  }

  broadcastArticlesChanged('article:status-toggled');
  return updated;
}

export async function deleteAdminArticle(id: string): Promise<void> {
  await apiFetch<{ success: boolean; message: string }>(`/api/admin/articles/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });

  const reachable = await isSupabaseReachable();
  if (reachable) {
    try {
      await supabase.from('articles').delete().or(`id.eq.${id},slug.eq.${id}`);
    } catch {}
  }

  broadcastArticlesChanged('article:deleted');
}

// ==============================================================================
// ASSET & DOCUMENT MANAGEMENT
// ==============================================================================

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
    const rawText = rawResult.value;

    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const title = lines.length > 0 ? lines[0] : file.name.replace(/\.[^/.]+$/, '');
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

export async function uploadImageFile(file: File): Promise<{ success: boolean; url: string }> {
  try {
    const formData = new FormData();
    formData.append('image', file);

    const token = getAdminToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch('/api/admin/upload-image', {
      method: 'POST',
      headers,
      body: formData
    });

    if (res.ok) {
      const data = await res.json();
      return { success: true, url: data.url };
    }
  } catch (err) {
    console.warn('Image upload endpoint note, using FileReader data URL fallback:', err);
  }

  // Safe fallback to Data URL
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ success: true, url: reader.result as string });
    reader.onerror = () => resolve({
      success: true,
      url: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?q=80&w=1200&auto=format&fit=crop'
    });
    reader.readAsDataURL(file);
  });
}

// ==============================================================================
// CATEGORIES CRUD
// ==============================================================================

export async function createAdminCategory(data: { name: string; description?: string }): Promise<Category> {
  const res = await apiFetch<Category>('/api/admin/categories', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  broadcastArticlesChanged('category:created');
  return res;
}

export async function updateAdminCategory(id: string, data: { name?: string; description?: string }): Promise<Category> {
  const res = await apiFetch<Category>(`/api/admin/categories/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  broadcastArticlesChanged('category:updated');
  return res;
}

export async function deleteAdminCategory(id: string): Promise<void> {
  await apiFetch<{ success: boolean; message: string }>(`/api/admin/categories/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  broadcastArticlesChanged('category:deleted');
}

// ==============================================================================
// MESSAGES & INBOX CRUD
// ==============================================================================

export async function fetchAdminMessages(): Promise<Message[]> {
  return apiFetch<Message[]>('/api/admin/messages');
}

export async function toggleMessageRead(id: string, read?: boolean): Promise<Message> {
  const res = await apiFetch<Message>(`/api/admin/messages/${encodeURIComponent(id)}/read`, {
    method: 'PUT',
    body: JSON.stringify({ read })
  });
  broadcastArticlesChanged('message:updated');
  return res;
}

export async function replyToMessage(messageId: string, text: string): Promise<{ success: boolean; reply: any }> {
  const res = await apiFetch<{ success: boolean; reply: any }>(`/api/admin/messages/${encodeURIComponent(messageId)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ text })
  });
  broadcastArticlesChanged('message:replied');
  return res;
}

export async function deleteAdminMessage(id: string): Promise<void> {
  await apiFetch<{ success: boolean; message: string }>(`/api/admin/messages/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  broadcastArticlesChanged('message:deleted');
}
