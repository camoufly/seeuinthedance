#!/usr/bin/env python3
"""
seeuinthe.dance — Archive Uploader
Requires: pip install tkinter requests (tkinter is built-in on macOS)
"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import threading
import requests
import base64
import os
import json
from datetime import date

# ── CONFIG ───────────────────────────────────────────────────
API_URL    = "https://seeuinthe.dance/api/add-artifact"
API_SECRET = "archiver-seeuinthedance-2026"

MEDIA_TYPES = [
    ("audio-embed", "Audio embed (SoundCloud)"),
    ("video-embed", "Video embed (YouTube/Vimeo)"),
    ("audio-mp3",   "Audio file (MP3)"),
    ("video-mp4",   "Video file (MP4)"),
]

# ── APP ──────────────────────────────────────────────────────
class ArchiverApp:
    def __init__(self, root):
        self.root = root
        self.root.title("seeuinthe.dance — Archiver")
        self.root.geometry("540x480")
        self.root.resizable(False, False)
        self.root.configure(bg="#0a0a0a")

        self.file_path = None
        self._build_ui()

    def _build_ui(self):
        style = ttk.Style()
        style.theme_use("default")
        style.configure("TLabel",       background="#0a0a0a", foreground="#e8e4dc", font=("Menlo", 11))
        style.configure("TEntry",       fieldbackground="#1a1a1a", foreground="#e8e4dc", insertcolor="#e8e4dc", font=("Menlo", 11))
        style.configure("TCombobox",    fieldbackground="#1a1a1a", foreground="#e8e4dc", font=("Menlo", 11))
        style.configure("TButton",      background="#222", foreground="#e8e4dc", font=("Menlo", 11), padding=8)
        style.map("TButton",            background=[("active", "#333")])
        style.configure("Accent.TButton", background="#c8ff00", foreground="#000", font=("Menlo", 11, "bold"), padding=10)
        style.map("Accent.TButton",     background=[("active", "#aadd00")])

        pad = {"padx": 24, "pady": 6}

        # Title
        tk.Label(self.root, text="seeuinthe.dance", bg="#0a0a0a", fg="#e8e4dc",
                 font=("Menlo", 13, "bold")).pack(pady=(24, 2))
        tk.Label(self.root, text="audiovisual archive — add artifact", bg="#0a0a0a",
                 fg="#666", font=("Menlo", 10)).pack(pady=(0, 20))

        # Form frame
        f = tk.Frame(self.root, bg="#0a0a0a")
        f.pack(fill="x", padx=24)

        def row(label, widget_fn, *args, **kwargs):
            tk.Label(f, text=label, bg="#0a0a0a", fg="#888", font=("Menlo", 9),
                     anchor="w").pack(fill="x", pady=(8,1))
            w = widget_fn(f, *args, **kwargs)
            w.pack(fill="x", ipady=4)
            return w

        # Title
        self.title_var = tk.StringVar()
        self.title_entry = row("TITLE", tk.Entry, textvariable=self.title_var,
                               bg="#1a1a1a", fg="#e8e4dc", insertbackground="#e8e4dc",
                               relief="flat", font=("Menlo", 11))

        # Date
        self.date_var = tk.StringVar(value=str(date.today()))
        self.date_entry = row("DATE (YYYY-MM-DD)", tk.Entry, textvariable=self.date_var,
                              bg="#1a1a1a", fg="#e8e4dc", insertbackground="#e8e4dc",
                              relief="flat", font=("Menlo", 11))

        # Type
        tk.Label(f, text="TYPE", bg="#0a0a0a", fg="#888", font=("Menlo", 9),
                 anchor="w").pack(fill="x", pady=(8,1))
        self.type_var = tk.StringVar(value="audio-embed")
        type_frame = tk.Frame(f, bg="#0a0a0a")
        type_frame.pack(fill="x")
        self.type_menu = ttk.Combobox(type_frame, textvariable=self.type_var,
                                       values=[t[0] for t in MEDIA_TYPES],
                                       state="readonly", font=("Menlo", 11))
        self.type_menu.pack(fill="x", ipady=4)
        self.type_var.trace("w", self._on_type_change)

        # Src / File area
        self.src_frame = tk.Frame(f, bg="#0a0a0a")
        self.src_frame.pack(fill="x")

        # Embed URL
        self.src_var = tk.StringVar()
        self.src_label = tk.Label(self.src_frame, text="EMBED URL", bg="#0a0a0a",
                                   fg="#888", font=("Menlo", 9), anchor="w")
        self.src_label.pack(fill="x", pady=(8,1))
        self.src_entry = tk.Entry(self.src_frame, textvariable=self.src_var,
                                   bg="#1a1a1a", fg="#e8e4dc", insertbackground="#e8e4dc",
                                   relief="flat", font=("Menlo", 11))
        self.src_entry.pack(fill="x", ipady=4)

        # File picker (hidden initially)
        self.file_label = tk.Label(self.src_frame, text="FILE", bg="#0a0a0a",
                                    fg="#888", font=("Menlo", 9), anchor="w")
        self.file_path_var = tk.StringVar(value="no file selected")
        self.file_path_label = tk.Label(self.src_frame, textvariable=self.file_path_var,
                                         bg="#0a0a0a", fg="#555", font=("Menlo", 10), anchor="w")
        self.file_btn = tk.Button(self.src_frame, text="Choose file…", command=self._pick_file,
                                   bg="#222", fg="#e8e4dc", relief="flat", font=("Menlo", 10),
                                   activebackground="#333", activeforeground="#e8e4dc",
                                   padx=10, pady=6, cursor="hand2")

        # Status
        self.status_var = tk.StringVar(value="")
        tk.Label(self.root, textvariable=self.status_var, bg="#0a0a0a", fg="#888",
                 font=("Menlo", 9)).pack(pady=(12, 0))

        # Progress bar
        self.progress = ttk.Progressbar(self.root, mode="indeterminate", length=300)
        self.progress.pack(pady=4)

        # Submit
        tk.Button(self.root, text="ADD TO ARCHIVE →", command=self._submit,
                  bg="#c8ff00", fg="#000", relief="flat", font=("Menlo", 12, "bold"),
                  activebackground="#aadd00", activeforeground="#000",
                  padx=20, pady=10, cursor="hand2").pack(pady=16)

    def _on_type_change(self, *_):
        t = self.type_var.get()
        is_file = t in ("audio-mp3", "video-mp4")

        # Show/hide embed URL
        if is_file:
            self.src_label.pack_forget()
            self.src_entry.pack_forget()
            self.file_label.pack(fill="x", pady=(8,1))
            self.file_path_label.pack(fill="x")
            self.file_btn.pack(anchor="w", pady=4)
        else:
            self.file_label.pack_forget()
            self.file_path_label.pack_forget()
            self.file_btn.pack_forget()
            self.src_label.pack(fill="x", pady=(8,1))
            self.src_entry.pack(fill="x", ipady=4)

    def _pick_file(self):
        t = self.type_var.get()
        filetypes = [("MP3 files", "*.mp3")] if t == "audio-mp3" else [("MP4 files", "*.mp4")]
        path = filedialog.askopenfilename(filetypes=filetypes)
        if path:
            self.file_path = path
            self.file_path_var.set(os.path.basename(path))

    def _submit(self):
        title = self.title_var.get().strip()
        date_val = self.date_var.get().strip()
        media_type = self.type_var.get()

        if not title:
            messagebox.showerror("Error", "Title is required")
            return
        if not date_val:
            messagebox.showerror("Error", "Date is required")
            return

        is_file = media_type in ("audio-mp3", "video-mp4")

        if is_file:
            if not self.file_path:
                messagebox.showerror("Error", "Please select a file")
                return
        else:
            if not self.src_var.get().strip():
                messagebox.showerror("Error", "Embed URL is required")
                return

        self.progress.start()
        self.status_var.set("uploading…")
        threading.Thread(target=self._upload, args=(title, date_val, media_type, is_file), daemon=True).start()

    def _upload(self, title, date_val, media_type, is_file):
        try:
            payload = {
                "title": title.upper(),
                "date": date_val,
                "type": media_type,
            }

            if is_file:
                with open(self.file_path, "rb") as f:
                    file_bytes = f.read()
                payload["file"]     = base64.b64encode(file_bytes).decode()
                payload["filename"] = os.path.basename(self.file_path)
                payload["mimetype"] = "audio/mpeg" if media_type == "audio-mp3" else "video/mp4"
            else:
                payload["src"] = self.src_var.get().strip()

            res = requests.post(
                API_URL,
                json=payload,
                headers={"x-artifact-secret": API_SECRET},
                timeout=120,
            )

            if res.ok:
                data = res.json()
                self.root.after(0, self._on_success, data.get("id", "?"))
            else:
                self.root.after(0, self._on_error, f"{res.status_code}: {res.text}")

        except Exception as e:
            self.root.after(0, self._on_error, str(e))

    def _on_success(self, artifact_id):
        self.progress.stop()
        self.status_var.set(f"✓ artifact #{artifact_id} added — deploying…")
        messagebox.showinfo("Done", f"Artifact #{artifact_id} added!\nVercel is deploying — live in ~30 seconds.")
        self._reset()

    def _on_error(self, msg):
        self.progress.stop()
        self.status_var.set("error")
        messagebox.showerror("Error", msg)

    def _reset(self):
        self.title_var.set("")
        self.date_var.set(str(date.today()))
        self.type_var.set("audio-embed")
        self.src_var.set("")
        self.file_path = None
        self.file_path_var.set("no file selected")
        self.status_var.set("")


if __name__ == "__main__":
    root = tk.Tk()
    app = ArchiverApp(root)
    root.mainloop()
