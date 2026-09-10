-- ==============================================================================
-- EMIOLUWA'S DESK - SUPABASE SCHEMA, ROLES & RLS POLICIES
-- ==============================================================================
-- Run this entire script in your Supabase project's SQL Editor:
-- https://supabase.com/dashboard/project/shqmmrwamvnwsgxmwres/sql/new
--
-- This script ensures:
-- 1. All author accounts are confirmed in auth.users and granted 'admin' in public.profiles.
-- 2. RLS policies explicitly allow authenticated admins to:
--    - READ, UPDATE, and DELETE categories
--    - READ and DELETE messages
--    - READ, INSERT, and DELETE message_replies
--    - READ and INSERT website_views
-- 3. Enables the website_views table for unique visitor tracking.
-- ==============================================================================

-- Step 1: Ensure Email Confirmation for Author Accounts in auth.users
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
    confirmed_at = COALESCE(confirmed_at, now())
WHERE email IN (
  'emioluwawrites@gmail.com',
  'lifeofgod2912@gmail.com',
  'fayoseayomipo18@gmail.com'
);

-- Step 2: Ensure Profiles Table Exists and Links to auth.users with 'admin' Role
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT DEFAULT 'Emioluwa',
  bio TEXT DEFAULT 'Young Nigerian writer, essayist, and student crafting words that connect and stories that stay.',
  avatar_url TEXT,
  role TEXT DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Upsert admin profiles for author accounts
INSERT INTO public.profiles (id, email, name, role)
SELECT id, email, 'Emioluwa', 'admin'
FROM auth.users
WHERE email IN (
  'emioluwawrites@gmail.com',
  'lifeofgod2912@gmail.com',
  'fayoseayomipo18@gmail.com'
)
ON CONFLICT (id) DO UPDATE
SET role = 'admin',
    email = EXCLUDED.email;

-- Step 3: Ensure Categories Table Exists
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Step 4: Ensure Messages Table Exists
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'contact',
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Step 5: Ensure Message Replies Table Exists
CREATE TABLE IF NOT EXISTS public.message_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  reply_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Step 6: Ensure Website Views Table Exists
CREATE TABLE IF NOT EXISTS public.website_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id TEXT NOT NULL,
  viewed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 1. CATEGORIES POLICIES
-- ------------------------------------------------------------------------------
-- Public can view categories on the public blog
DROP POLICY IF EXISTS "Public can view categories" ON public.categories;
CREATE POLICY "Public can view categories" ON public.categories
FOR SELECT USING (true);

-- Authenticated admins can insert categories
DROP POLICY IF EXISTS "Admins can insert categories" ON public.categories;
CREATE POLICY "Admins can insert categories" ON public.categories
FOR INSERT TO authenticated
WITH CHECK (
  auth.role() = 'authenticated'
);

-- Authenticated admins can update categories
DROP POLICY IF EXISTS "Admins can update categories" ON public.categories;
CREATE POLICY "Admins can update categories" ON public.categories
FOR UPDATE TO authenticated
USING (
  auth.role() = 'authenticated'
)
WITH CHECK (
  auth.role() = 'authenticated'
);

-- Authenticated admins can delete categories
DROP POLICY IF EXISTS "Admins can delete categories" ON public.categories;
CREATE POLICY "Admins can delete categories" ON public.categories
FOR DELETE TO authenticated
USING (
  auth.role() = 'authenticated'
);

-- ------------------------------------------------------------------------------
-- 2. MESSAGES POLICIES
-- ------------------------------------------------------------------------------
-- Public readers can submit contact/say-hello messages
DROP POLICY IF EXISTS "Public can insert messages" ON public.messages;
CREATE POLICY "Public can insert messages" ON public.messages
FOR INSERT WITH CHECK (true);

-- Authenticated admins can read messages
DROP POLICY IF EXISTS "Admins can view messages" ON public.messages;
CREATE POLICY "Admins can view messages" ON public.messages
FOR SELECT TO authenticated
USING (
  auth.role() = 'authenticated'
);

-- Authenticated admins can update messages (e.g. read status)
DROP POLICY IF EXISTS "Admins can update messages" ON public.messages;
CREATE POLICY "Admins can update messages" ON public.messages
FOR UPDATE TO authenticated
USING (
  auth.role() = 'authenticated'
)
WITH CHECK (
  auth.role() = 'authenticated'
);

-- Authenticated admins can delete messages
DROP POLICY IF EXISTS "Admins can delete messages" ON public.messages;
CREATE POLICY "Admins can delete messages" ON public.messages
FOR DELETE TO authenticated
USING (
  auth.role() = 'authenticated'
);

-- ------------------------------------------------------------------------------
-- 3. MESSAGE REPLIES POLICIES
-- ------------------------------------------------------------------------------
-- Authenticated admins can view replies
DROP POLICY IF EXISTS "Admins can view message replies" ON public.message_replies;
CREATE POLICY "Admins can view message replies" ON public.message_replies
FOR SELECT TO authenticated
USING (
  auth.role() = 'authenticated'
);

-- Authenticated admins can insert replies
DROP POLICY IF EXISTS "Admins can insert message replies" ON public.message_replies;
CREATE POLICY "Admins can insert message replies" ON public.message_replies
FOR INSERT TO authenticated
WITH CHECK (
  auth.role() = 'authenticated'
);

-- Authenticated admins can delete replies
DROP POLICY IF EXISTS "Admins can delete message replies" ON public.message_replies;
CREATE POLICY "Admins can delete message replies" ON public.message_replies
FOR DELETE TO authenticated
USING (
  auth.role() = 'authenticated'
);

-- ------------------------------------------------------------------------------
-- 4. WEBSITE VIEWS POLICIES
-- ------------------------------------------------------------------------------
-- Public visitors can record unique view
DROP POLICY IF EXISTS "Public can insert website views" ON public.website_views;
CREATE POLICY "Public can insert website views" ON public.website_views
FOR INSERT WITH CHECK (true);

-- Anyone can read total count of views
DROP POLICY IF EXISTS "Public can view website views count" ON public.website_views;
CREATE POLICY "Public can view website views count" ON public.website_views
FOR SELECT USING (true);

-- ------------------------------------------------------------------------------
-- 5. PROFILES POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public can view profiles" ON public.profiles;
CREATE POLICY "Public can view profiles" ON public.profiles
FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can update their profile" ON public.profiles;
CREATE POLICY "Admins can update their profile" ON public.profiles
FOR UPDATE TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);
