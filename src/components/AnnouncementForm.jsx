import React, { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function AnnouncementForm() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [author, setAuthor] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!title.trim() || !body.trim()) {
      setError("Title and message are required.");
      return;
    }
    setPosting(true);
    const { error } = await supabase.from("announcements").insert({
      title: title.trim(),
      body: body.trim(),
      author: author.trim() || null,
    });
    setPosting(false);
    if (error) {
      console.error(error);
      setError(error.message);
      return;
    }
    // Clear the form; list updates via Realtime
    setTitle("");
    setBody("");
    setAuthor("");
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl bg-white p-5 shadow-sm space-y-3"
    >
      <h2 className="font-semibold">Post to Bulletin Board</h2>

      <input
        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <textarea
        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        placeholder="Message"
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      <input
        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        placeholder="Author (optional)"
        value={author}
        onChange={(e) => setAuthor(e.target.value)}
      />

      {error && <div className="text-sm text-red-600">{error}</div>}

      <button
        type="submit"
        disabled={posting}
        className="px-4 py-2 rounded-xl bg-black text-white hover:bg-gray-800 text-sm font-medium disabled:opacity-50"
      >
        {posting ? "Posting…" : "Post"}
      </button>
    </form>
  );
}
