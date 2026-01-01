import React, { useState, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Search, 
  Upload, 
  ExternalLink, 
  Code, 
  Cpu, 
  Layout, 
  Database, 
  Terminal, 
  Layers, 
  Hash, 
  Loader2,
  Trash2,
  RefreshCw,
  Bookmark
} from "lucide-react";

// --- Types ---
interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  description?: string;
  category?: string;
  tags?: string[];
  processed: boolean;
  addedAt: number;
}

interface AICategorizationResponse {
  items: {
    originalUrl: string; // To map back to our ID
    category: string;
    description: string;
    tags: string[];
  }[];
}

// --- Icons Map ---
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "Frontend": <Layout size={18} />,
  "Backend": <Database size={18} />,
  "DevOps": <Terminal size={18} />,
  "AI/ML": <Cpu size={18} />,
  "Design": <Layers size={18} />,
  "Productivity": <Bookmark size={18} />,
  "Other": <Hash size={18} />,
  "Uncategorized": <Code size={18} />
};

// --- Initialization ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const App = () => {
  // -- State --
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(() => {
    const saved = localStorage.getItem("my-ai-bookmarks");
    return saved ? JSON.parse(saved) : [];
  });
  
  const [filterCategory, setFilterCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  
  // -- Effects --
  useEffect(() => {
    localStorage.setItem("my-ai-bookmarks", JSON.stringify(bookmarks));
  }, [bookmarks]);

  // -- Helpers --
  const generateId = () => Math.random().toString(36).substr(2, 9);

  // -- Handlers --
  
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const htmlContent = e.target?.result as string;
      parseBookmarksHTML(htmlContent);
    };
    reader.readAsText(file);
    setImportModalOpen(false);
  };

  const parseBookmarksHTML = (html: string) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const links = Array.from(doc.querySelectorAll("a"));
    
    // Limit import to 50 for this demo to avoid massive token usage immediately
    // In a real app, we'd paginate the processing.
    const newBookmarks: BookmarkItem[] = links.slice(0, 50).map(link => ({
      id: generateId(),
      title: link.textContent || "Untitled",
      url: link.href,
      processed: false,
      addedAt: Date.now()
    }));

    // Filter duplicates based on URL
    const existingUrls = new Set(bookmarks.map(b => b.url));
    const uniqueNewBookmarks = newBookmarks.filter(b => !existingUrls.has(b.url));

    setBookmarks(prev => [...prev, ...uniqueNewBookmarks]);
  };

  const processUnprocessedBookmarks = async () => {
    const unprocessed = bookmarks.filter(b => !b.processed);
    if (unprocessed.length === 0) return;

    setIsProcessing(true);

    // Process in batches of 10 to fit in context window easily and show progress
    const BATCH_SIZE = 10;
    const batches = [];
    for (let i = 0; i < unprocessed.length; i += BATCH_SIZE) {
      batches.push(unprocessed.slice(i, i + BATCH_SIZE));
    }

    let updatedBookmarksMap = new Map(bookmarks.map(b => [b.id, b]));

    try {
      for (const batch of batches) {
        const batchInput = batch.map(b => ({ title: b.title, url: b.url }));
        
        const prompt = `
          Analyze the following developer tools/bookmarks. 
          For each, provide:
          1. A Category (Choose strictly from: "Frontend", "Backend", "DevOps", "AI/ML", "Design", "Productivity", "Other").
          2. A short description (max 15 words).
          3. 3-4 relevant tags (e.g., "React", "Python", "CSS").
          
          Return as JSON.
          
          Input: ${JSON.stringify(batchInput)}
        `;

        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      url: { type: Type.STRING },
                      category: { type: Type.STRING },
                      description: { type: Type.STRING },
                      tags: { type: Type.ARRAY, items: { type: Type.STRING } }
                    }
                  }
                }
              }
            }
          }
        });

        const result = JSON.parse(response.text || "{\"items\": []}") as { items: any[] };
        
        // Merge results
        result.items?.forEach(processedItem => {
          // Find the original bookmark by URL
          const original = batch.find(b => b.url === processedItem.url);
          if (original) {
            updatedBookmarksMap.set(original.id, {
              ...original,
              processed: true,
              category: processedItem.category,
              description: processedItem.description,
              tags: processedItem.tags
            });
          }
        });
        
        // Update state progressively after each batch
        setBookmarks(Array.from(updatedBookmarksMap.values()));
      }
    } catch (error) {
      console.error("Error processing bookmarks:", error);
      alert("Something went wrong with the AI processing. Check console.");
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteBookmark = (id: string) => {
    setBookmarks(prev => prev.filter(b => b.id !== id));
  };

  // -- Derived State --
  const categories = useMemo(() => {
    const cats = new Set<string>();
    bookmarks.forEach(b => {
      if (b.category) cats.add(b.category);
    });
    return ["All", ...Array.from(cats).sort(), "Uncategorized"];
  }, [bookmarks]);

  const filteredBookmarks = useMemo(() => {
    return bookmarks.filter(b => {
      const matchesSearch = (
        b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.tags?.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
      );
      
      const matchesCategory = filterCategory === "All" 
        ? true 
        : filterCategory === "Uncategorized" 
          ? !b.category 
          : b.category === filterCategory;

      return matchesSearch && matchesCategory;
    });
  }, [bookmarks, searchQuery, filterCategory]);

  const unprocessedCount = bookmarks.filter(b => !b.processed).length;

  return (
    <div className="flex h-screen overflow-hidden">
      
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col hidden md:flex">
        <div className="p-6">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2">
            <Cpu size={24} className="text-blue-500" />
            DevMind
          </h1>
          <p className="text-xs text-slate-500 mt-1">AI Bookmark Manager</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${
                filterCategory === cat 
                  ? "bg-blue-600/10 text-blue-400 border border-blue-600/20" 
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              {CATEGORY_ICONS[cat] || CATEGORY_ICONS["Other"]}
              <span>{cat}</span>
              {cat === "All" && <span className="ml-auto text-xs opacity-50">{bookmarks.length}</span>}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800">
           {unprocessedCount > 0 ? (
             <button
              onClick={processUnprocessedBookmarks}
              disabled={isProcessing}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white p-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
             >
               {isProcessing ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
               {isProcessing ? "Analyzing..." : `Process ${unprocessedCount} New`}
             </button>
           ) : (
            <div className="text-center text-xs text-slate-600">
              All bookmarks synced
            </div>
           )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
        
        {/* Top Header */}
        <header className="h-16 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md flex items-center justify-between px-6 z-10">
          <div className="relative w-96 hidden sm:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input 
              type="text" 
              placeholder="Search bookmarks, tags, descriptions..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-full py-2 pl-10 pr-4 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all placeholder:text-slate-600"
            />
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => setImportModalOpen(true)}
              className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm font-medium"
            >
              <Upload size={18} />
              <span className="hidden sm:inline">Import Chrome Bookmarks</span>
            </button>
          </div>
        </header>

        {/* Scrollable Grid */}
        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          {bookmarks.length === 0 ? (
             <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-4">
               <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mb-4">
                 <Bookmark size={32} className="text-slate-600" />
               </div>
               <h2 className="text-xl font-semibold text-slate-300">No bookmarks yet</h2>
               <p className="max-w-md text-center text-slate-500">
                 Import your Chrome bookmarks to get started. The AI will automatically categorize and tag them for you.
               </p>
               <button 
                onClick={() => setImportModalOpen(true)}
                className="mt-4 px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors"
               >
                 Import Now
               </button>
             </div>
          ) : (
            <>
              <div className="mb-6 flex items-baseline justify-between">
                <h2 className="text-2xl font-bold text-slate-200">{filterCategory}</h2>
                <span className="text-slate-500 text-sm">{filteredBookmarks.length} results</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
                {filteredBookmarks.map(bookmark => (
                  <BookmarkCard 
                    key={bookmark.id} 
                    item={bookmark} 
                    onDelete={() => deleteBookmark(bookmark.id)} 
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </main>

      {/* Import Modal */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-8 max-w-md w-full shadow-2xl relative">
            <button 
              onClick={() => setImportModalOpen(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-white"
            >
              ✕
            </button>
            <h3 className="text-xl font-bold text-white mb-2">Import Bookmarks</h3>
            <p className="text-slate-400 text-sm mb-6">
              Export your bookmarks from Chrome (Bookmark Manager -> Export Bookmarks) and upload the HTML file here. 
              <br/><br/>
              <span className="text-xs text-yellow-500/80">Note: For this demo, we'll process the first 50 links to save tokens.</span>
            </p>
            
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-700 border-dashed rounded-lg cursor-pointer bg-slate-800/50 hover:bg-slate-800 transition-colors">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Upload className="w-8 h-8 mb-3 text-slate-400" />
                <p className="text-sm text-slate-500">
                  <span className="font-semibold">Click to upload</span> or drag and drop
                </p>
                <p className="text-xs text-slate-600">HTML file only</p>
              </div>
              <input type="file" className="hidden" accept=".html" onChange={handleFileUpload} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Subcomponents ---

interface BookmarkCardProps {
  item: BookmarkItem;
  onDelete: () => void;
}

const BookmarkCard: React.FC<BookmarkCardProps> = ({ item, onDelete }) => {
  return (
    <div className="group relative bg-slate-900 border border-slate-800 hover:border-blue-500/30 rounded-xl p-5 flex flex-col transition-all duration-300 hover:shadow-lg hover:shadow-blue-900/10 hover:-translate-y-1">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${getCategoryColor(item.category || "Uncategorized")} bg-opacity-10`}>
          {CATEGORY_ICONS[item.category || "Uncategorized"] || <Hash size={20} />}
        </div>
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onDelete} className="text-slate-600 hover:text-red-400 transition-colors">
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      
      <h3 className="font-semibold text-slate-200 line-clamp-1 mb-1" title={item.title}>
        {item.title}
      </h3>
      
      <p className="text-sm text-slate-500 line-clamp-2 mb-4 h-10">
        {item.processed ? item.description : "Waiting for analysis..."}
      </p>

      {item.tags && item.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {item.tags.slice(0, 3).map(tag => (
            <span key={tag} className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              #{tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto pt-4 border-t border-slate-800 flex items-center justify-between">
         <span className="text-[10px] text-slate-600 font-mono">
           {new Date(item.addedAt).toLocaleDateString()}
         </span>
         <a 
          href={item.url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
         >
           Visit <ExternalLink size={12} />
         </a>
      </div>

      {!item.processed && (
        <div className="absolute top-2 right-2">
           <span className="flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
          </span>
        </div>
      )}
    </div>
  );
};

function getCategoryColor(cat: string) {
  switch(cat) {
    case 'Frontend': return 'text-blue-400';
    case 'Backend': return 'text-green-400';
    case 'DevOps': return 'text-orange-400';
    case 'AI/ML': return 'text-purple-400';
    case 'Design': return 'text-pink-400';
    default: return 'text-slate-400';
  }
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);