import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

export interface Article {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  category: string;
  featuredImage: string;
  readTime: string;
  publishedAt: string;
  status: 'draft' | 'published';
  views?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  articleCount?: number;
}

export interface Message {
  id: string;
  name: string;
  email: string;
  subject?: string;
  message: string;
  type: 'contact' | 'say_hello';
  read: boolean;
  createdAt: string;
  replies?: Array<{
    id: string;
    text: string;
    sentAt: string;
  }>;
}

export interface AdminUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  bio: string;
}

export interface DatabaseSchema {
  admin: AdminUser;
  categories: Category[];
  articles: Article[];
  messages: Message[];
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Initial seed articles written in Emioluwa's authentic Nigerian student & literary voice
const INITIAL_CATEGORIES: Category[] = [
  {
    id: 'cat-1',
    name: 'Student Life',
    slug: 'student-life',
    description: 'Reflections from lecture halls, hostel corridors, exams, and the messy beauty of school.',
  },
  {
    id: 'cat-2',
    name: 'Personal Growth',
    slug: 'personal-growth',
    description: 'Lessons on patience, discipline, navigating setbacks, and building character in your twenties.',
  },
  {
    id: 'cat-3',
    name: 'Self-Discovery',
    slug: 'self-discovery',
    description: 'Unravelling identity, finding your voice, understanding your inner compass, and gentle honesty.',
  },
  {
    id: 'cat-4',
    name: 'Life Experiences',
    slug: 'life-experiences',
    description: 'Moments from Lagos to Ibadan, rainy mornings, family dinners, and ordinary days turned into essays.',
  },
  {
    id: 'cat-5',
    name: 'Opinions',
    slug: 'opinions',
    description: 'Thoughtful perspectives on modern culture, reading habits, friendship dynamics, and youthful ambition.',
  },
  {
    id: 'cat-6',
    name: 'Creative Writing',
    slug: 'creative-writing',
    description: 'Short stories, poetic prose, vignettes, and narratives crafted with heart and imagery.',
  },
];

const INITIAL_ARTICLES: Article[] = [
  {
    id: 'art-seed-1',
    slug: 'starting-small-what-lecture-halls-in-akoka-taught-me',
    title: 'Starting Small: What Lecture Halls in Akoka Taught Me About Showing Up',
    excerpt: 'Reflections on walking into 8 AM lectures, feeling unremarkable among hundreds of ambitious peers, and discovering that quiet consistency counts more than loud beginnings.',
    content: '<p>There is a specific kind of quiet that fills a university amphitheatre before the lecturer walks in. Papers rustle, metal chairs creak against worn tiles, and everyone pretends to be slightly more prepared than they actually are.</p><p>When I first started attending classes here in Akoka, I felt swallowed whole. In Lagos, everyone is always moving with an aggressive sense of destiny. Students discuss side hustles, tech fellowships, exchange programs, and five-year master plans with a casual fluency that left me wondering if I had somehow arrived late to my own life.</p><p>For months, I thought the only way to matter was to make a dramatic entrance. I thought I needed an extraordinary breakthrough or a viral milestone to justify the space I occupied.</p><p>Then one rainy Tuesday in November, watching rain lash the glass louvers of the faculty library, I realised something freeing: most enduring things are built without fanfare. The students who truly mastered the difficult courses were not the ones boasting in the courtyard; they were the ones who sat in the second row every morning, notebooks open, taking notes with calm regularity.</p><p>Starting small is not an admission of defeat; it is a confession of patience. It means respecting the seedling before you demand shade from the oak. If you have only twenty minutes to read today, read for twenty minutes. If you have only one honest paragraph in you tonight, write that single paragraph. The harvest takes care of itself when you protect the discipline of showing up.</p>',
    category: 'Student Life',
    featuredImage: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?q=80&w=1200&auto=format&fit=crop',
    readTime: '4 min read',
    publishedAt: '2026-08-15',
    status: 'published',
    views: 42,
    createdAt: '2026-08-15T09:00:00.000Z',
    updatedAt: '2026-08-15T09:00:00.000Z'
  },
  {
    id: 'art-seed-2',
    slug: 'the-art-of-slow-growth-in-an-urgent-world',
    title: 'The Art of Slow Growth in an Urgent World',
    excerpt: 'When everyone around you seems to be announcing milestones and breakthrough seasons, choosing patience feels like rebellion. Here is why slow roots weather the storm.',
    content: '<p>We live in an era that worships the overnight sensation. Social media timelines are algorithmic parades of congratulations: <em>\'I am thrilled to announce,\' \'At 21, I just bought,\' \'So grateful for this sudden elevation.\'</em></p><p>If you are not careful, you begin measuring your private chapter two against someone else\'s curated chapter twenty. You begin suspecting your quiet days of being wasted days.</p><p>I have had to teach my heart to slow down. The bamboo spends years developing an underground root network before a single shoot pierces the soil. To the casual observer, nothing is happening. But beneath the surface, an intricate architecture of survival is being forged.</p><p>When success comes prematurely, before character has been tempered by delay, it crumbles under the first gust of adversity. Slow growth gives you the gift of obscurity—the freedom to make mistakes where nobody is taking screenshots, the grace to refine your taste in silence, and the resilience to stay grounded when praise eventually arrives.</p><p>Give yourself permission to grow at the speed of wisdom, not the speed of an algorithm.</p>',
    category: 'Personal Growth',
    featuredImage: 'https://images.unsplash.com/photo-1457369804613-52c61a468e7d?q=80&w=1200&auto=format&fit=crop',
    readTime: '5 min read',
    publishedAt: '2026-08-28',
    status: 'published',
    views: 68,
    createdAt: '2026-08-28T14:30:00.000Z',
    updatedAt: '2026-08-28T14:30:00.000Z'
  },
  {
    id: 'art-seed-3',
    slug: 'rainy-mornings-in-lagos-unopened-notebook',
    title: 'Rainy Mornings in Lagos and the Comfort of an Unopened Notebook',
    excerpt: 'Some days the yellow Danfo buses crawl through damp streets, the kettle whistles, and writing becomes less of a performance and more of a sanctuary.',
    content: '<p>When rain falls over Lagos, the entire city lowers its voice by a single octave. The perpetual blare of vehicle horns softens against damp tarmac, and the relentless speed of the day pauses, if only for an hour.</p><p>On such mornings, I like sitting near the dining table with a steaming mug of tea and a fresh notebook. There is something sacred about an empty lined page before a pen has touched it—a clean slate holding no regrets from yesterday and no demands for tomorrow.</p><p>As young writers, we are often pressured to monetize every thought or turn every feeling into consumable content. But some words are meant only for the journal. Some observations are meant to be savored privately, like the scent of rain on dry red earth or the sound of your mother singing softly in the kitchen.</p><p>Writing, at its truest, is not about being seen by thousands; it is about paying attention to the life you have been given right here, right now.</p>',
    category: 'Life Experiences',
    featuredImage: 'https://images.unsplash.com/photo-1519682337058-a94d519337bc?q=80&w=1200&auto=format&fit=crop',
    readTime: '3 min read',
    publishedAt: '2026-09-02',
    status: 'published',
    views: 35,
    createdAt: '2026-09-02T10:15:00.000Z',
    updatedAt: '2026-09-02T10:15:00.000Z'
  }
];

const INITIAL_MESSAGES: Message[] = [
  {
    id: 'msg-initial-1',
    name: 'Chioma Adeyemi',
    email: 'chioma.adeyemi@unilag.edu.ng',
    subject: 'Thank you for the essay on Starting Small',
    message: 'Good morning Emioluwa, I just read your piece on navigating student life in Lagos. Your reflections on lecture halls and staying true to your values gave me so much courage for my exams this semester. Keep writing—your words resonate deeply!',
    type: 'contact',
    read: false,
    createdAt: '2026-09-06T14:20:00.000Z',
    replies: []
  },
  {
    id: 'hello-initial-2',
    name: 'David Okafor',
    email: 'david.okafor.writes@gmail.com',
    subject: 'Say Hello Note',
    message: 'Hello Emioluwa! Stumbled upon your blog from a fellow student\'s post in Ibadan. I love the calm, thoughtful rhythm of your essays. Always looking forward to your next release!',
    type: 'say_hello',
    read: false,
    createdAt: '2026-09-07T03:15:00.000Z',
    replies: []
  }
];

function ensureDataDirectory() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function initDatabase(): DatabaseSchema {
  ensureDataDirectory();
  
  if (!fs.existsSync(DB_FILE)) {
    // Default admin password hash
    const passwordHash = process.env.ADMIN_INITIAL_PASSWORD 
      ? bcrypt.hashSync(process.env.ADMIN_INITIAL_PASSWORD, bcrypt.genSaltSync(10))
      : '$2b$10$vF4W8OgHc77AmocyEPcNwuo3XlnHUmurNjxpdmGqHVSCyz0TutyJi';

    const initialDb: DatabaseSchema = {
      admin: {
        id: 'admin-1',
        email: 'emioluwawrites@gmail.com',
        passwordHash,
        name: 'Emioluwa',
        bio: 'Young Nigerian writer, essayist, and student crafting words that connect and stories that stay.'
      },
      categories: INITIAL_CATEGORIES,
      articles: INITIAL_ARTICLES,
      messages: INITIAL_MESSAGES
    };

    fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2), 'utf-8');
    return initialDb;
  }

  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw) as DatabaseSchema;
  } catch (err) {
    console.error('Error reading database file, re-initializing:', err);
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync('Emioluwa2026!', salt);

    const fallbackDb: DatabaseSchema = {
      admin: {
        id: 'admin-1',
        email: 'emioluwawrites@gmail.com',
        passwordHash,
        name: 'Emioluwa',
        bio: 'Young Nigerian writer, essayist, and student crafting words that connect and stories that stay.'
      },
      categories: INITIAL_CATEGORIES,
      articles: INITIAL_ARTICLES,
      messages: INITIAL_MESSAGES
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(fallbackDb, null, 2), 'utf-8');
    return fallbackDb;
  }
}

export function getDatabase(): DatabaseSchema {
  return initDatabase();
}

export function saveDatabase(data: DatabaseSchema): void {
  ensureDataDirectory();
  // Atomic write via temp file
  const tempFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempFile, DB_FILE);
}
