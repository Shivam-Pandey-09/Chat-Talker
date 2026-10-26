
"use client";
 
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import "./promo.css";
import {
  Bell,
  Check,
  ChevronLeft,
  Compass,
  Eye,
  EyeOff,
  Home,
  LogOut,
  MessageCircle,
  Moon,
  MoreHorizontal,
  Plus,
  Pencil,
  Search,
  Send,
  Settings,
  Shield,
  Sun,
  UserRound,
  UserPlus,
  Users,
  X,
} from "lucide-react";
 
type View =
  | "welcome"
  | "login"
  | "forgot"
  | "signup"
  | "home"
  | "messages"
  | "random"
  | "profile"
  | "contact-profile"
  | "settings"
  | "notifications";
type Person = {
  id: string;
  name: string;
  gender: string;
  online?: boolean;
  preview: string;
  color: string;
};
type Message = {
  id: number;
  text: string;
  own: boolean;
  time: string;
  queued?: boolean;
};
type FriendRequest = { id: string; name: string; color: string; time: string };
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const avatarColors = ["rose", "blue", "teal", "violet"];
function colorFor(id: string) {
  let sum = 0;
  for (const ch of id) sum += ch.charCodeAt(0);
  return avatarColors[sum % avatarColors.length];
}
type Banner = {
  active: boolean;
  mode: "card" | "html";
  label: string;
  title: string;
  body: string;
  imageUrl: string;
  buttonText: string;
  linkUrl: string;
  html: string;
  htmlHeight: number;
};
const emptyBanner: Banner = {
  active: true,
  mode: "card",
  label: "Sponsored",
  title: "",
  body: "",
  imageUrl: "",
  buttonText: "",
  linkUrl: "",
  html: "",
  htmlHeight: 200,
};
type SearchPerson = { id: number; username: string; relation: string };
type ServerUser = {
  id: number;
  username: string;
  gender?: string | null;
  online?: boolean;
  created_at?: string;
};
function toPerson(u: ServerUser): Person {
  const id = String(u.id);
  return {
    id,
    name: u.username,
    gender: u.gender ?? "Unknown",
    online: !!u.online,
    preview: "",
    color: colorFor(id),
  };
}
function timeAgo(iso?: string) {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso + "Z").getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
async function apiFetch(path: string, method = "GET", body?: object) {
  const token = localStorage.getItem("ct-token");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
const nav: { id: View; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "messages", label: "Messages", icon: Send },
  { id: "random", label: "Discover", icon: Compass },
  { id: "profile", label: "Profile", icon: UserRound },
];
 
function Avatar({
  name,
  color = "violet",
  size = "normal",
  online = false,
}: {
  name: string;
  color?: string;
  size?: "normal" | "large" | "small";
  online?: boolean;
}) {
  return (
    <span
      className={`avatar avatar-${color} avatar-${size}`}
      aria-label={`${name}'s avatar`}
    >
      <span>
        {name
          .split(/\s+/)
          .map((p) => p[0])
          .slice(0, 2)
          .join("")}
      </span>
      {online && <i className="online-dot" />}
    </span>
  );
}
 
export default function App() {
  const [view, setView] = useState<View>("welcome");
  const [theme, setTheme] = useState("system");
  const [systemDark, setSystemDark] = useState(true);
  const [gender, setGender] = useState("Any gender");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [randomMatchId, setRandomMatchId] = useState<string | null>(null);
  const [newChatRequested, setNewChatRequested] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [unreadIds, setUnreadIds] = useState<string[]>([]);
  // Har dost ke saath last message ka time (is browser mein yaad rehta hai, DB use nahi hota)
  const [lastMsgAt, setLastMsgAt] = useState<Record<string, number>>({});
  // Kaun abhi "typing..." kar raha hai (friend ka id, ya random chat ke liye "stranger")
  const [typingMap, setTypingMap] = useState<Record<string, boolean>>({});
  const lastTypingSentRef = useRef(0);
  const [editingProfile, setEditingProfile] = useState(false);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [draft, setDraft] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [showGender, setShowGender] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matchPreference, setMatchPreference] = useState("Any gender");
  const [notifications, setNotifications] = useState<FriendRequest[]>([]);
  const [friends, setFriends] = useState<Person[]>([]);
  const [outgoing, setOutgoing] = useState<Person[]>([]);
  const [blockedPeople, setBlockedPeople] = useState<Person[]>([]);
  const [booting, setBooting] = useState(true);
  const [peopleResults, setPeopleResults] = useState<SearchPerson[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [editingBanner, setEditingBanner] = useState(false);
  const [bannerForm, setBannerForm] = useState<Banner>(emptyBanner);
  const [bannerSaving, setBannerSaving] = useState(false);
  const myIdRef = useRef<number | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const friendsRef = useRef<Person[]>([]);
  const viewRef = useRef<View>("welcome");
  activeIdRef.current = activeId;
  friendsRef.current = friends;
  viewRef.current = view;
  const friendIds = friends.map((p) => p.id);
  const sentRequests = outgoing.map((p) => p.id);
  const blockedIds = blockedPeople.map((p) => p.id);
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authGender, setAuthGender] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authInfo, setAuthInfo] = useState("");
  const [needsVerifyEmail, setNeedsVerifyEmail] = useState("");
  const [resetStep, setResetStep] = useState<"email" | "code">("email");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const keepInfoRef = useRef(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authUsername, setAuthUsername] = useState("");
  const [authContactType, setAuthContactType] = useState<"email" | "phone">("email");
  const [usernameStatus, setUsernameStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle");
  const [usernameHint, setUsernameHint] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const [stranger, setStranger] = useState<Person | null>(null);
  const [strangerLeft, setStrangerLeft] = useState(false);
  useEffect(() => {
    if (view !== "signup") return;
    const u = authUsername.trim();
    if (!u) {
      setUsernameStatus("idle");
      setUsernameHint("");
      return;
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_]{2,19}$/.test(u)) {
      setUsernameStatus("invalid");
      setUsernameHint("Username must be 3-20 characters long and contain only letters, numbers, and underscores");
      return;
    }
    setUsernameStatus("checking");
    setUsernameHint("Checking…");
    let cancelled = false;
    const id = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `${API}/auth/check-username?username=${encodeURIComponent(u)}`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (data.available) {
          setUsernameStatus("available");
          setUsernameHint("✓ Available username");
        } else {
          setUsernameStatus("taken");
          setUsernameHint(data.reason ?? "Username already taken");
        }
      } catch {
        if (!cancelled) {
          setUsernameStatus("idle");
          setUsernameHint("");
        }
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [authUsername, view]);
  useEffect(() => {
    setAuthError("");
    setShowPassword(false);
    if (keepInfoRef.current) keepInfoRef.current = false;
    else setAuthInfo("");
  }, [view]);
  useEffect(() => {
    // Email ke link par click karke wapas aane par
    const p = new URLSearchParams(window.location.search);
    const v = p.get("verified");
    if (v === null) return;
    window.history.replaceState({}, "", window.location.pathname);
    keepInfoRef.current = true;
    setAuthInfo(
      v === "1"
        ? "Your email verification is complete. You may now log in."
        : "Verification link is invalid or has expired. Please login and request a new one."
    );
    setView("login");
  }, []);
  async function loadSocial() {
    const { ok, status, data } = await apiFetch("/social/overview");
    if (status === 401) {
      localStorage.removeItem("ct-token");
      window.location.reload();
      return;
    }
    if (!ok) return;
    setFriends((data.friends as ServerUser[]).map(toPerson));
    setOutgoing((data.outgoing as ServerUser[]).map(toPerson));
    setBlockedPeople((data.blocked as ServerUser[]).map(toPerson));
    setNotifications(
      (data.incoming as ServerUser[]).map((u) => ({
        id: String(u.id),
        name: u.username,
        color: colorFor(String(u.id)),
        time: timeAgo(u.created_at),
      })),
    );
  }
  useEffect(() => {
    if (!searchOpen) return;
    const q = query.trim();
    if (q.length < 2) {
      setPeopleResults([]);
      setPeopleLoading(false);
      return;
    }
    setPeopleLoading(true);
    let cancelled = false;
    const id = window.setTimeout(async () => {
      try {
        const { ok, data } = await apiFetch(
          `/social/search?q=${encodeURIComponent(q)}`,
        );
        if (cancelled) return;
        setPeopleResults(ok ? (data.users as SearchPerson[]) : []);
      } catch {
        if (!cancelled) setPeopleResults([]);
      } finally {
        if (!cancelled) setPeopleLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [searchOpen, query]);
  useEffect(() => {
    if (view !== "home") return;
    apiFetch("/banner")
      .then(({ ok, data }) => {
        if (ok) {
          setBanner(data.banner);
          setIsAdmin(!!data.isAdmin);
        }
      })
      .catch(() => {
        /* backend band hai: box nahi dikhega */
      });
  }, [view]);
  useEffect(() => {
    const token = localStorage.getItem("ct-token");
    if (!token) {
      setBooting(false);
      return;
    }
    apiFetch("/auth/me")
      .then(({ ok, status, data }) => {
        if (ok) {
          myIdRef.current = data.user.id;
          const nextAccount = {
            name: data.user.name,
            username: data.user.username,
            bio: data.user.bio ?? "",
            gender: data.user.gender ?? "Prefer not to say",
          };
          setAccount(nextAccount);
          localStorage.setItem("ct-profile", JSON.stringify(nextAccount));
          setView("home");
        } else if (status === 401) {
          localStorage.removeItem("ct-token");
        }
      })
      .catch(() => {
        /* backend band hai: welcome screen pe hi rehne do */
      })
      .finally(() => setBooting(false));
  }, []);
  const isAuthView =
    view === "welcome" || view === "login" || view === "signup" || view === "forgot";
  useEffect(() => {
    if (isAuthView) return;
    const token = localStorage.getItem("ct-token");
    if (!token) return;
 
    const socket = io(API, { auth: { token } });
    socketRef.current = socket;
    const typingTimers: Record<string, number> = {};
    const clearTyping = (id: string) => {
      window.clearTimeout(typingTimers[id]);
      setTypingMap((o) => (o[id] ? { ...o, [id]: false } : o));
    };
    const showTyping = (id: string) => {
      setTypingMap((o) => (o[id] ? o : { ...o, [id]: true }));
      window.clearTimeout(typingTimers[id]);
      typingTimers[id] = window.setTimeout(() => clearTyping(id), 3000);
    };
    const touchChats = (ids: string[]) =>
      setLastMsgAt((old) => {
        const now = Date.now();
        const next = { ...old };
        for (const id of ids) next[id] = now;
        try {
          localStorage.setItem("ct-lastmsg", JSON.stringify(next));
        } catch {
          /* storage full ya band hai */
        }
        return next;
      });
    const nowTime = () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date());
 
    socket.on("connect", () => {
      loadSocial();
    });
    socket.on("social_update", () => {
      loadSocial();
    });
    socket.on("presence", ({ userId, online }: { userId: number; online: boolean }) => {
      setFriends((old) =>
        old.map((p) => (p.id === String(userId) ? { ...p, online } : p)),
      );
    });
    socket.on(
      "dm",
      (m: { from: number; to: number; text: string; queued?: boolean }) => {
        const me = myIdRef.current;
        const own = m.from === me;
        const other = String(own ? m.to : m.from);
        touchChats([other]);
        if (!own) clearTyping(other);
        setMessages((old) => ({
          ...old,
          [other]: [
            ...(old[other] ?? []),
            {
              id: Date.now() + Math.random(),
              text: m.text,
              own,
              time: nowTime(),
              queued: own ? m.queued : undefined,
            },
          ],
        }));
        const viewing =
          viewRef.current === "messages" && activeIdRef.current === other;
        if (!own && !viewing) {
          setUnreadIds((cur) => (cur.includes(other) ? cur : [...cur, other]));
          const senderName =
            friendsRef.current.find((p) => p.id === other)?.name ?? "Someone";
          const short = m.text.length > 60 ? `${m.text.slice(0, 60)}…` : m.text;
          setNotice(`New message from ${senderName}: ${short}`);
        }
      },
    );
    socket.on(
      "pending_dms",
      (rows: { id: number; from: number; text: string }[], done: () => void) => {
        touchChats([...new Set(rows.map((r) => String(r.from)))]);
        setMessages((old) => {
          const next = { ...old };
          for (const r of rows) {
            const key = String(r.from);
            next[key] = [
              ...(next[key] ?? []),
              {
                id: Date.now() + Math.random(),
                text: r.text,
                own: false,
                time: nowTime(),
              },
            ];
          }
          return next;
        });
        setUnreadIds((cur) => [
          ...new Set([...cur, ...rows.map((r) => String(r.from))]),
        ]);
        setNotice(`You have ${rows.length} new message${rows.length > 1 ? "s" : ""} from while you were away.`);
        done();
      },
    );
    socket.on("dm_delivered", ({ by }: { by: number }) => {
      const key = String(by);
      setMessages((old) =>
        old[key]
          ? {
              ...old,
              [key]: old[key].map((m) => (m.queued ? { ...m, queued: false } : m)),
            }
          : old,
      );
    });
    socket.on("connect_error", (err) => {
      setMatching(false);
      setNotice(`Failed to connect to server: ${err.message}`);
    });
    socket.on("waiting", () => {
      setNotice("No one available at the moment. Please wait…");
    });
    socket.on(
      "match_found",
      ({ partner }: { partner: { id: number; name: string; gender?: string } }) => {
        setMatching(false);
        setShowGender(false);
        setNewChatRequested(false);
        setStranger({
          id: String(partner.id),
          name: partner.name,
          gender: partner.gender ?? "Unknown",
          online: true,
          preview: "",
          color: "teal",
        });
        setStrangerLeft(false);
        setMessages((old) => ({ ...old, stranger: [] }));
        setActiveId("stranger");
        setView("messages");
        setMobileList(false);
        setChatMenuOpen(false);
        setNotice(`You’re connected with ${partner.name}. Say hello!`);
      },
    );
    socket.on("typing", ({ from }: { from: number }) => {
      showTyping(String(from));
    });
    socket.on("partner_typing", () => {
      showTyping("stranger");
    });
    socket.on("receive_message", (m: { text: string; from: string }) => {
      if (m.from !== socket.id) clearTyping("stranger");
      setMessages((old) => ({
        ...old,
        stranger: [
          ...(old.stranger ?? []),
          {
            id: Date.now() + Math.random(),
            text: m.text,
            own: m.from === socket.id,
            time: nowTime(),
          },
        ],
      }));
    });
    socket.on("partner_left", () => {
      clearTyping("stranger");
      setStrangerLeft(true);
      setMessages((old) => ({
        ...old,
        stranger: [
          ...(old.stranger ?? []),
          {
            id: Date.now() + Math.random(),
            text: "The other user has left the chat.",
            own: false,
            time: nowTime(),
          },
        ],
      }));
      setNotice("The user has left the chat.");
    });
 
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthView]);
  const [account, setAccount] = useState({
    name: "Taylor Morgan",
    username: "taylorm",
    bio: "Curious about people, places, and the little things. 🌿",
    gender: "Prefer not to say",
  });
  const [mobileList, setMobileList] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const contactsList = useMemo(
    () => [
      ...friends,
      ...blockedPeople.filter((b) => !friends.some((f) => f.id === b.id)),
    ],
    [friends, blockedPeople],
  );
  const activeContact =
    activeId === "stranger"
      ? stranger
      : (contactsList.find((person) => person.id === activeId) ?? null);
  const brandLogoSrc =
    theme === "light" || (theme === "system" && !systemDark)
      ? "/ct-black.svg"
      : "/ct-white.svg";
  const filteredContacts = useMemo(
    () =>
      contactsList
        .map((person) => ({
          ...person,
          preview:
            (messages[person.id] ?? []).at(-1)?.text ??
            (person.online ? "Online now" : "Offline"),
        }))
        .filter((person) =>
          `${person.name} ${person.preview}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .sort(
          (a, b) =>
            (lastMsgAt[b.id] ?? 0) - (lastMsgAt[a.id] ?? 0) ||
            a.name.localeCompare(b.name),
        ),
    [contactsList, messages, query, lastMsgAt],
  );
 
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ct-lastmsg");
      if (saved) setLastMsgAt(JSON.parse(saved));
    } catch {
      /* kharab data ho to ignore */
    }
  }, []);
  useEffect(() => {
    const savedTheme = localStorage.getItem("ct-theme");
    if (savedTheme) setTheme(savedTheme);
    const savedAccount = localStorage.getItem("ct-profile");
    if (savedAccount) {
      try {
        setAccount(JSON.parse(savedAccount));
      } catch {
        /* use defaults */
      }
    }
    const savedGender = localStorage.getItem("ct-match-gender");
    if (savedGender) setGender(savedGender);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme =
      theme === "system" ? (systemDark ? "dark" : "light") : theme;
  }, [theme, systemDark]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeId]);
  useEffect(() => {
    document.title = unreadIds.length > 0 ? `(${unreadIds.length}) Chat Talker` : "Chat Talker";
  }, [unreadIds]);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(id);
  }, [notice]);
 
  function go(next: View) {
    setView(next);
    if (next !== "messages") setMobileList(true);
  }
  function openChat(id: string) {
    setActiveId(id);
    setView("messages");
    setMobileList(false);
    setUnreadIds((current) => current.filter((unreadId) => unreadId !== id));
    setChatMenuOpen(false);
  }
  async function reportContact() {
    setChatMenuOpen(false);
    if (!activeContact || !activeId) return;
    const reason = window.prompt(
      `Why are you reporting ${activeContact.name}? (Please provide a reason)`
    );
    if (reason === null) return; // cancel dabaya
    if (!reason.trim()) {
      setNotice("A reason is required to submit a report.");
      return;
    }
    const recent = (messages[activeId] ?? []).slice(-10).map((m) => ({ own: m.own, text: m.text }));
    const { ok, data } = await apiFetch("/social/report", "POST", {
      userId: Number(activeContact.id),
      reason: reason.trim(),
      messages: recent,
    });
    setNotice(
      ok
        ? "Report submitted. We will review it. You can also block this user if you wish."
        : (data.error ?? "Report failed, please try again later.")
    );
  }
  function notifyTyping() {
    const socket = socketRef.current;
    if (!socket || !socket.connected || !activeId) return;
    if (activeId === "stranger" && strangerLeft) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return; // 2 second mein 1 baar
    lastTypingSentRef.current = now;
    if (activeId === "stranger") socket.emit("typing_random");
    else socket.emit("typing", { to: Number(activeId) });
  }
  function sendMessage(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !activeId) return;
    if (activeId === "stranger") {
      if (strangerLeft) {
        setNotice("The chat has ended. Find a new match.");
        return;
      }
      socketRef.current?.emit("send_message", text);
      setDraft("");
      return;
    }
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      setNotice("Failed to connect to server. Please try again later.");
      return;
    }
    socket.emit(
      "dm_send",
      { to: Number(activeId), text },
      (res: { ok: boolean; error?: string }) => {
        if (!res?.ok) setNotice(res?.error ?? "Message failed to send.");
      },
    );
    setDraft("");
  }
  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const { ok, data } = await apiFetch("/auth/profile", "PUT", {
      name: account.name,
      bio: account.bio,
      gender: account.gender,
    });
    if (!ok) {
      setNotice(data.error ?? "Failed to save profile.");
      return;
    }
    const saved = {
      name: data.user.name,
      username: data.user.username,
      bio: data.user.bio ?? "",
      gender: data.user.gender ?? "Prefer not to say",
    };
    setAccount(saved);
    localStorage.setItem("ct-profile", JSON.stringify(saved));
    setEditingProfile(false);
    setNotice("Profile updated");
  }
  function saveTheme(value: string) {
    setTheme(value);
    localStorage.setItem("ct-theme", value);
  }
  function startMatching() {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      setNotice("Failed to connect to server. Is the backend running?");
      return;
    }
    setMatching(true);
    socket.emit("find_match", { preference: matchPreference });
  }
  function closeGenderModal() {
    if (matching) {
      socketRef.current?.emit("leave_chat");
      setMatching(false);
    }
    setShowGender(false);
  }
  function chooseGender(value: string) {
    setMatchPreference(value);
    setGender(value);
    localStorage.setItem("ct-match-gender", value);
  }
  async function sendFriendRequest(person: Person) {
    if (friendIds.includes(person.id) || sentRequests.includes(person.id)) return;
    const { ok, data } = await apiFetch("/social/friend-request", "POST", {
      userId: Number(person.id),
    });
    if (!ok) {
      setNotice(data.error ?? "Failed to send friend request.");
      return;
    }
    await loadSocial();
    setNotice(
      data.status === "accepted"
        ? `You and ${person.name} are now friends.`
        : `Friend request sent to ${person.name}.`,
    );
  }
  async function respondToFriendRequest(requestId: string, accept: boolean) {
    const request = notifications.find((item) => item.id === requestId);
    const { ok, data } = await apiFetch("/social/friend-request/respond", "POST", {
      userId: Number(requestId),
      accept,
    });
    if (!ok) {
      setNotice(data.error ?? "Failed to respond to friend request.");
      return;
    }
    await loadSocial();
    if (accept && request) setNotice(`${request.name} added to your friends.`);
    else setNotice("Friend request cancelled.");
  }
  function openBannerEditor() {
    setBannerForm(banner ?? emptyBanner);
    setEditingBanner(true);
  }
  async function saveBanner(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBannerSaving(true);
    try {
      const { ok, data } = await apiFetch("/banner", "PUT", bannerForm);
      if (!ok) {
        setNotice(data.error ?? "Failed to save banner.");
        return;
      }
      setBanner(data.banner);
      setEditingBanner(false);
      setNotice("Promo box updated");
    } catch {
      setNotice("Failed to connect to server.");
    } finally {
      setBannerSaving(false);
    }
  }
  function beginNewChat() {
    setNewChatRequested(true);
    go("random");
    setShowGender(true);
  }
  async function removeFriend() {
    if (!activeContact) return;
    const { ok, data } = await apiFetch("/social/unfriend", "POST", {
      userId: Number(activeContact.id),
    });
    setChatMenuOpen(false);
    if (!ok) {
      setNotice(data.error ?? "Failed to remove friend.");
      return;
    }
    await loadSocial();
    setNotice(`${activeContact.name} removed from your friends.`);
  }
  async function blockContact() {
    if (!activeContact) return;
    const wasBlocked = blockedIds.includes(activeContact.id);
    const { ok, data } = await apiFetch(
      wasBlocked ? "/social/unblock" : "/social/block",
      "POST",
      { userId: Number(activeContact.id) },
    );
    setChatMenuOpen(false);
    if (!ok) {
      setNotice(data.error ?? "some error occurred. Please try again.");
      return;
    }
    if (!wasBlocked && activeId === "stranger") {
      socketRef.current?.emit("leave_chat");
      setStrangerLeft(true);
    }
    await loadSocial();
    setNotice(wasBlocked ? `${activeContact.name} unblocked.` : `${activeContact.name} blocked.`);
  }
    async function authRequest(path: string, body: object) {
    setAuthError("");
    setAuthLoading(true);
    try {
      const res = await fetch(`${API}/auth/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAuthError(data.error ?? "Something went wrong, please try again");
        if (data.needsVerification) setNeedsVerifyEmail(data.email ?? authEmail.trim());
        return;
      }
      if (data.needsVerification) {
        // Signup ho gaya, ab email verify karna hai
        setNeedsVerifyEmail(authEmail.trim());
        setAuthPassword("");
        keepInfoRef.current = true;
        setAuthInfo(
          data.message ??
            "A verification link has been sent to your email. Please check both your inbox and spam folder."
        );
        setView("login");
        return;
      }
      localStorage.setItem("ct-token", data.token);
      myIdRef.current = data.user.id;
      const nextAccount = {
        name: data.user.name,
        username: data.user.username,
        bio: data.user.bio ?? "",
        gender: data.user.gender ?? "Prefer not to say",
      };
      setAccount(nextAccount);
      localStorage.setItem("ct-profile", JSON.stringify(nextAccount));
      setAuthPassword("");
      setView("home");
    } catch {
      setAuthError("Failed to connect to server. Is the backend running?");
    } finally {
      setAuthLoading(false);
    }
  }
  function finishSignup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (usernameStatus !== "available") {
      setAuthError("Please select an available username first.");
      return;
    }
    authRequest("signup", {
      name: authName.trim(),
      username: authUsername.trim(),
      contactType: "email",
      contact: authEmail.trim(),
      password: authPassword,
      gender: authGender,
    });
  }
  function finishLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    authRequest("login", {
      identifier: authEmail.trim(),
      password: authPassword,
    });
  }
 
  async function postAuth(path: string, body: object) {
    const res = await fetch(`${API}/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }
 
  async function resendVerification() {
    setAuthError("");
    setAuthLoading(true);
    try {
      const { ok, data } = await postAuth("resend-verification", { email: needsVerifyEmail });
      if (ok) setAuthInfo(data.message ?? "A verification link has been sent to your email. Please check both your inbox and spam folder.");
      else setAuthError(data.error ?? "Please try again.");
    } catch {
      setAuthError("Failed to connect to server.");
    } finally {
      setAuthLoading(false);
    }
  }
 
  async function submitPasswordReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAuthError("");
    setAuthInfo("");
    setAuthLoading(true);
    try {
      if (resetStep === "email") {
        const { ok, data } = await postAuth("forgot-password", { email: authEmail.trim() });
        if (!ok) {
          setAuthError(data.error ?? "Please try again.");
          return;
        }
        setResetStep("code");
        setAuthInfo(
          "If this email is registered, a 6-digit code has been sent. Please check your inbox and spam folder."
        );
      } else {
        const { ok, data } = await postAuth("reset-password", {
          email: authEmail.trim(),
          code: resetCode.trim(),
          newPassword: resetNewPassword,
        });
        if (!ok) {
          setAuthError(data.error ?? "Please try again.");
          return;
        }
        setResetCode("");
        setResetNewPassword("");
        setResetStep("email");
        keepInfoRef.current = true;
        setAuthInfo(data.message ?? "Password has been changed, please login.");
        setView("login");
      }
    } catch {
      setAuthError("Failed to connect to server.");
    } finally {
      setAuthLoading(false);
    }
  }
 
  const contactLabel =
    view === "signup"
      ? authContactType === "email" ? "Email" : "Phone number"
      : view === "forgot" ? "Email" : "Email or username";
  const contactPlaceholder =
    view === "signup"
      ? authContactType === "email" ? "you@example.com" : "+91 98765 43210"
      : view === "forgot" ? "you@example.com" : "Email or username";
  const contactInputType =
    view === "signup"
      ? authContactType === "phone" ? "tel" : "email"
      : view === "forgot" ? "email" : "text";
 
  if (booting) return <div className="app-shell" aria-busy="true" />;
 
  return (
    <div className="app-shell">
      {(view === "welcome" || view === "login" || view === "signup" || view === "forgot") && (
        <main className="auth-shell">
          <section className="auth-card">
            <img
              className="auth-logo"
              src="/ct-app-logo.png"
              alt="ChatTalker"
            />
            <span className="eyebrow">A LITTLE HELLO GOES A LONG WAY</span>
            <h1>
              {view === "welcome" ? (
                <>
                  Catch a glimpse into the lives of people
                  <br />
                  <em>you’re destined to meet.</em>
                </>
              ) : view === "login" ? (
                "Welcome back"
              ) : view === "forgot" ? (
                "Reset your password"
              ) : (
                "Create your account"
              )}
            </h1>
            {view === "welcome" ? (
              <div className="auth-actions">
                <button
                  className="primary-btn"
                  onClick={() => setView("login")}
                >
                  Log in
                </button>
                <button
                  className="secondary-btn"
                  onClick={() => setView("signup")}
                >
                  Create new account
                </button>
              </div>
            ) : (
              <form
                className="auth-form"
                onSubmit={view === "signup" ? finishSignup : view === "forgot" ? submitPasswordReset : finishLogin}
              >
                {view === "forgot" && (
                  <p className="auth-help">
                    {resetStep === "email"
                      ? "Enter the email address connected to your account."
                      : "An email with a 6-digit code has been sent. Please enter the code and your new password."}
                  </p>
                )}
                {view === "signup" && (
                  <label>
                    Your name
                    <input
                      autoComplete="name"
                      required
                      value={authName}
                      onChange={(e) => setAuthName(e.target.value)}
                      placeholder="Name"
                    />
                  </label>
                )}
                                {view === "signup" && (
                  <>
                    <label>
                      Username
                      <input
                        autoComplete="off"
                        required
                        maxLength={20}
                        value={authUsername}
                        onChange={(e) =>
                          setAuthUsername(e.target.value.replace(/\s/g, ""))
                        }
                        placeholder="e.g. shivam_01"
                      />
                      {usernameStatus !== "idle" && (
                        <span className={`username-hint ${usernameStatus}`}>
                          {usernameHint}
                        </span>
                      )}
                    </label>
                  </>
                )}
                <label>
                  {contactLabel}
                  <input
                    autoComplete={view === "signup" ? (authContactType === "phone" ? "tel" : "email") : "username"}
                    type={contactInputType}
                    required
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder={contactPlaceholder}
                  />
                </label>
                {view === "forgot" && resetStep === "code" && (
                  <>
                    <label>
                      6 digit code
                      <input
                        inputMode="numeric"
                        maxLength={6}
                        required
                        value={resetCode}
                        onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="123456"
                      />
                    </label>
                    <label>
                      New password
                      <span className="pw-field">
                      <input
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        minLength={8}
                        required
                        value={resetNewPassword}
                        onChange={(e) => setResetNewPassword(e.target.value)}
                        placeholder="At least 8 characters"
                      />
                  <button
                    type="button"
                    className="pw-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
                    </label>
                  </>
                )}
                {view !== "forgot" && <label>
                  Password
                  <span className="pw-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete={
                      view === "signup" ? "new-password" : "current-password"
                    }
                    minLength={8}
                    required
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="At least 8 characters"
                  />
                  <button
                    type="button"
                    className="pw-toggle"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
                </label>}
                {view === "signup" && (
                  <label>
                    Gender
                    <select
                      required
                      value={authGender}
                      onChange={(e) => setAuthGender(e.target.value)}
                    >
                      <option value="" disabled>
                        Select your gender
                      </option>
                        <option>Female</option>
                        <option>Man</option>
                        <option>Non-binary</option>
                      <option>Self-describe</option>
                      <option>Prefer not to say</option>
                    </select>
                  </label>
                )}
                {authInfo && <p className="auth-help" role="status">{authInfo}</p>}
                {authError && <p className="auth-error" role="alert">{authError}</p>}
                <button className="primary-btn" type="submit" disabled={authLoading}>
                  {authLoading
                    ? "Please wait…"
                    : view === "signup" ? "Create account" : view === "forgot" ? (resetStep === "email" ? "Send code" : "Change password") : "Log in"}
                </button>
                {view === "login" && <button className="auth-forgot" type="button" onClick={() => setView("forgot")}>Forgot password?</button>}
                {view === "login" && needsVerifyEmail && (
                  <button className="auth-forgot" type="button" onClick={resendVerification} disabled={authLoading}>
                    Resend verification email
                  </button>
                )}
                <button
                  className="auth-switch"
                  type="button"
                  onClick={() =>
                    setView(view === "signup" ? "login" : view === "forgot" ? "login" : "signup")
                  }
                >
                  {view === "signup"
                    ? "Already have an account? Log in"
                    : view === "forgot" ? "Back to log in" : "New to ChatTalker? Create an account"}
                </button>
                <button
                  className="auth-back"
                  type="button"
                  onClick={() => setView(view === "forgot" ? "login" : "welcome")}
                >
                  {view === "forgot" ? "← Back to login" : "← Back"}
                </button>
              </form>
            )}
          </section>
        </main>
      )}
      {!(view === "welcome" || view === "login" || view === "signup" || view === "forgot") && (
        <>
          <aside className="sidebar">
            <button
              className="brand-mark"
              aria-label="ChatTalker home"
              onClick={() => go("home")}
            >
              <img src={brandLogoSrc} alt="ChatTalker" />
            </button>
            <nav className="side-nav" aria-label="Main navigation">
              {nav.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  className={`nav-item ${view === id || (id === "messages" && view === "messages") ? "active" : ""}`}
                  onClick={() => go(id)}
                  title={label}
                  aria-label={label}
                >
                  <Icon size={21} strokeWidth={1.8} />
                  <span className="nav-label">{label}</span>
                  {id === "messages" && unreadIds.length > 0 && (
                    <i className="nav-unread-count" aria-label="Unread messages">
                      {unreadIds.length}
                    </i>
                  )}
                </button>
              ))}
            </nav>
            <button
              className={`nav-item ${view === "settings" ? "active" : ""}`}
              onClick={() => go("settings")}
              title="Settings"
              aria-label="Settings"
            >
              <Settings size={21} strokeWidth={1.8} />
              <span className="nav-label">Settings</span>
            </button>
            <button className="sidebar-profile" onClick={() => go("profile")}>
              <Avatar name={account.name} size="small" />
              <span>{account.name.split(" ")[0]}</span>
              <MoreHorizontal size={18} />
            </button>
            <div className="sidebar-logo">
              <img src={brandLogoSrc} alt="" />
              <span>ChatTalker</span>
            </div>
          </aside>
          <header className="mobile-header">
            <button
              className="brand-mark"
              onClick={() => go("home")}
              aria-label="ChatTalker home"
            >
              <img src={brandLogoSrc} alt="ChatTalker" />
            </button>
            <span className="mobile-title">
              {view === "home"
                ? "Good afternoon"
                : view === "messages"
                  ? (activeContact?.name ?? "Messages")
                  : view === "random"
                    ? "Discover"
                  : view === "contact-profile"
                    ? (activeContact?.name ?? "Profile")
                    : view === "profile"
                      ? "Your profile"
                      : view === "notifications"
                        ? "Notifications"
                        : "Settings"}
            </span>
            <div className="mobile-header-actions">
              <button className="icon-btn" onClick={() => setSearchOpen(true)} aria-label="Search"><Search size={19} /></button>
              <button className="icon-btn notification-btn" onClick={() => go("notifications")} aria-label="Notifications"><Bell size={19} />{notifications.length > 0 && <i />}</button>
            </div>
          </header>
 
          <main
            className={`main-content ${view === "messages" ? "main-messages" : ""}`}
          >
            {view === "home" && (
              <section className="home-page">
                <div className="topline">
                  <div className="greeting">
                    <span className="eyebrow">Simply Lovely</span>
                    <h1>
                      A little hello can
                      <br className="desktop-break" /> go a long way.
                    </h1>
                    <p>Make a new connection, or pick up where you left off.</p>
                  </div>
                  <div className="top-actions">
                    <button
                      className="icon-btn"
                      onClick={() => setSearchOpen(true)}
                      aria-label="Search"
                    >
                      <Search size={19} />
                    </button>
                    <button
                      className="icon-btn notification-btn"
                      onClick={() => go("notifications")}
                      aria-label="Notifications"
                    >
                      <Bell size={19} />
                      {notifications.length > 0 && <i />}
                    </button>
                  </div>
                </div>
                <div className="hero-card">
                  <div className="hero-copy">
                    <div className="hero-kicker">
                      <span className="live-pulse" /> A WORLD OF CONVERSATIONS
                    </div>
                    <h2>
                      Meet someone
                      <br />
                      <span>unexpected.</span>
                    </h2>
                    <p>
                      There’s a whole world of stories out there.
                      <br />
                      Your next favorite conversation is one hello away.
                    </p>
                    <button
                      className="primary-btn"
                      onClick={() => {
                        go("random");
                        setShowGender(true);
                      }}
                    >
                      Find someone{" "}
                      <ChevronLeft size={17} className="arrow-right" />
                    </button>
                  </div>
                </div>
                {(banner?.active || isAdmin) && (
                  banner?.active || editingBanner ? (
                    <section className="promo-card" aria-label="Promoted content">
                      {isAdmin && !editingBanner && (
                        <button className="promo-edit" onClick={openBannerEditor}>
                          <Pencil size={12} /> Edit
                        </button>
                      )}
                      {editingBanner ? (
                        <form className="promo-form" onSubmit={saveBanner}>
                          <label className="promo-check">
                            <input
                              type="checkbox"
                              checked={bannerForm.active}
                              onChange={(e) =>
                                setBannerForm({ ...bannerForm, active: e.target.checked })
                              }
                            />
                            Show this box on Home for everyone
                          </label>
                          <div className="promo-form-row">
                            <label>
                              Type
                              <select
                                value={bannerForm.mode}
                                onChange={(e) =>
                                  setBannerForm({
                                    ...bannerForm,
                                    mode: e.target.value === "html" ? "html" : "card",
                                  })
                                }
                              >
                                <option value="card">Card (title, text, image, button)</option>
                                <option value="html">HTML / ad embed code</option>
                              </select>
                            </label>
                            <label>
                              Small label
                              <input
                                maxLength={20}
                                value={bannerForm.label}
                                onChange={(e) =>
                                  setBannerForm({ ...bannerForm, label: e.target.value })
                                }
                                placeholder="Sponsored"
                              />
                            </label>
                          </div>
                          {bannerForm.mode === "card" ? (
                            <>
                              <label>
                                Title
                                <input
                                  maxLength={120}
                                  value={bannerForm.title}
                                  onChange={(e) =>
                                    setBannerForm({ ...bannerForm, title: e.target.value })
                                  }
                                  placeholder="Big headline"
                                />
                              </label>
                              <label>
                                Text
                                <textarea
                                  rows={3}
                                  maxLength={400}
                                  value={bannerForm.body}
                                  onChange={(e) =>
                                    setBannerForm({ ...bannerForm, body: e.target.value })
                                  }
                                  placeholder="One or two short lines"
                                />
                              </label>
                              <label>
                                Image link (optional)
                                <input
                                  value={bannerForm.imageUrl}
                                  onChange={(e) =>
                                    setBannerForm({ ...bannerForm, imageUrl: e.target.value })
                                  }
                                  placeholder="https://…/banner.png"
                                />
                                <small>Image online hosted honi chahiye aur https:// se shuru.</small>
                              </label>
                              <div className="promo-form-row">
                                <label>
                                  Button text
                                  <input
                                    maxLength={40}
                                    value={bannerForm.buttonText}
                                    onChange={(e) =>
                                      setBannerForm({ ...bannerForm, buttonText: e.target.value })
                                    }
                                    placeholder="Learn more"
                                  />
                                </label>
                                <label>
                                  Button link (ad link)
                                  <input
                                    value={bannerForm.linkUrl}
                                    onChange={(e) =>
                                      setBannerForm({ ...bannerForm, linkUrl: e.target.value })
                                    }
                                    placeholder="https://…"
                                  />
                                </label>
                              </div>
                            </>
                          ) : (
                            <>
                              <label>
                                HTML / embed code
                                <textarea
                                  className="code"
                                  value={bannerForm.html}
                                  onChange={(e) =>
                                    setBannerForm({ ...bannerForm, html: e.target.value })
                                  }
                                  placeholder="<a href=&quot;https://…&quot;><img src=&quot;https://…&quot;></a>"
                                />
                                <small>
                                  Ye ek alag surakshit dabbe (sandbox) mein chalta hai. Ad networks ka code
                                  (jaise AdSense) yahan kaam na kare, wo unki policy pe depend karta hai.
                                </small>
                              </label>
                              <label>
                                Box height (60 se 600 px)
                                <input
                                  type="number"
                                  min={60}
                                  max={600}
                                  value={bannerForm.htmlHeight}
                                  onChange={(e) =>
                                    setBannerForm({
                                      ...bannerForm,
                                      htmlHeight: Number(e.target.value) || 200,
                                    })
                                  }
                                />
                              </label>
                            </>
                          )}
                          <div className="promo-form-actions">
                            <button
                              type="button"
                              className="cancel-request-btn"
                              onClick={() => setEditingBanner(false)}
                            >
                              Cancel
                            </button>
                            <button className="primary-btn" type="submit" disabled={bannerSaving}>
                              {bannerSaving ? "Saving…" : "Save"}
                            </button>
                          </div>
                        </form>
                      ) : banner?.mode === "html" ? (
                        <div className="promo-frame-wrap">
                          {banner.label && <span className="promo-tag">{banner.label}</span>}
                          <iframe
                            className="promo-frame"
                            title="Promoted content"
                            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            srcDoc={banner.html}
                            style={{ height: banner.htmlHeight }}
                          />
                        </div>
                      ) : banner ? (
                        <div className="promo-body">
                          {banner.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className="promo-img"
                              src={banner.imageUrl}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          )}
                          <div className="promo-copy">
                            {banner.label && <span className="promo-tag">{banner.label}</span>}
                            {banner.title && <h3>{banner.title}</h3>}
                            {banner.body && <p>{banner.body}</p>}
                            {banner.linkUrl && (
                              <a
                                className="primary-btn promo-btn"
                                href={banner.linkUrl}
                                target="_blank"
                                rel="noopener noreferrer sponsored"
                              >
                                {banner.buttonText || "Learn more"}
                              </a>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </section>
                  ) : (
                    <div className="promo-empty">
                      <strong>Promo box abhi hidden hai</strong>
                      <span>Yahan ad, link ya announcement lagane ke liye Edit dabao. Ye box sirf tumhe dikh raha hai.</span>
                      <button className="primary-btn" style={{ justifySelf: "center" }} onClick={openBannerEditor}>
                        <Pencil size={13} /> Edit promo box
                      </button>
                    </div>
                  )
                )}
                <div className="bottom-note">
                  <span className="note-icon">
                    <Shield size={15} />
                  </span>
                  <span>
                    A kinder corner of the internet starts with all of us.
                  </span>
                  <button
                    onClick={() =>
                      setNotice(
                        "Be kind, keep your personal information private, and report anything that makes you uncomfortable.",
                      )
                    }
                  >
                    Our community promise{" "}
                    <ChevronLeft size={13} className="arrow-right" />
                  </button>
                </div>
              </section>
            )}
 
            {view === "notifications" && (
              <section className="notifications-page">
                <div className="profile-heading">
                  <span className="eyebrow">LITTLE HELLOS, COMING YOUR WAY</span>
                  <h1>Notifications</h1>
                  <p>Friend requests and updates about your conversations.</p>
                </div>
                <div className="notification-list">
                  {notifications.length === 0 ? (
                    <div className="notifications-empty">
                      <Bell size={23} />
                      <h2>You’re all caught up</h2>
                      <p>New friend requests will show up here.</p>
                    </div>
                  ) : notifications.map((request) => (
                    <article className="friend-request-card" key={request.id}>
                      <Avatar name={request.name} color={request.color} />
                      <div className="friend-request-copy">
                        <strong>{request.name}</strong>
                        <span>Would like to add you as a friend</span>
                        <small>{request.time}</small>
                      </div>
                      <div className="friend-request-actions">
                        <button className="primary-btn" onClick={() => respondToFriendRequest(request.id, true)}>Add friend</button>
                        <button className="cancel-request-btn" onClick={() => respondToFriendRequest(request.id, false)}>Cancel</button>
                      </div>
                    </article>
                  ))}
                  {outgoing.map((person) => (
                    <article className="friend-request-card sent-request" key={`sent-${person.id}`}><Avatar name={person.name} color={person.color} /><div className="friend-request-copy"><strong>{person.name}</strong><span>Friend request sent</span><small>Waiting for a reply</small></div><span className="pending-pill">Pending</span></article>
                  ))}
                </div>
              </section>
            )}
 
            {view === "messages" && (
              <section className="messenger">
                <aside
                  className={`contact-panel ${mobileList ? "mobile-visible" : "mobile-hidden"}`}
                >
                  <div className="contact-heading">
                    <div>
                      <span className="eyebrow">YOUR CORNER</span>
                      <h1>Messages</h1>
                    </div>
                  </div>
                  <div className="contact-search">
                    <Search size={17} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Find a conversation"
                      aria-label="Find a conversation"
                    />
                    <kbd>⌘ K</kbd>
                  </div>
                  <div className="contact-caption">
                    ALL CONVERSATIONS <span>{filteredContacts.length}</span>
                  </div>
                  <div className="contact-list">
                    {filteredContacts.map((person) => (
                      <button
                        key={person.id}
                        className={`contact-row ${activeId === person.id ? "selected" : ""}`}
                        onClick={() => openChat(person.id)}
                      >
                        <Avatar
                          name={person.name}
                          color={person.color}
                          online={person.online}
                        />
                        <span className="contact-copy">
                          <strong>{person.name}</strong>
                          <span>{person.preview}</span>
                        </span>
                        <span className="contact-time">
                          {unreadIds.includes(person.id) && (
                            <i className="unread-count">•</i>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="inbox-footer">
                    <span className="online-pip" /> You’re all caught up
                  </div>
                </aside>
                <div
                  className={`chat-panel ${mobileList ? "chat-mobile-hidden" : ""}`}
                >
                  {activeContact ? (
                    <>
                      <header className="chat-header">
                        <button
                          className="back-mobile icon-btn"
                          onClick={() => setMobileList(true)}
                          aria-label="Back to conversations"
                        >
                          <ChevronLeft size={20} />
                        </button>
                        <Avatar
                          name={activeContact.name}
                          color={activeContact.color}
                          online={activeContact.online}
                        />
                        <button className="chat-person-button" onClick={() => go("contact-profile")} aria-label={`View ${activeContact.name}'s profile`}>
                          <div className="chat-person">
                          <strong>{activeContact.name}</strong>
                          <span>
                            {typingMap[activeId ?? ""]
                              ? "typing…"
                              : activeId === "stranger"
                              ? "Random chat"
                              : activeContact.online
                                ? "Active now"
                                : "Offline"}
                          </span>
                          </div>
                        </button>
                        {activeId === "stranger" && (
                          friendIds.includes(activeContact.id) ? (
                            <span className="friend-status"><Check size={14} /> Friend</span>
                          ) : sentRequests.includes(activeContact.id) ? (
                            <span className="pending-pill">Request sent</span>
                          ) : (
                            <button className="add-friend-btn" onClick={() => sendFriendRequest(activeContact)}><UserPlus size={15} /> Add friend</button>
                          )
                        )}
                        <div className="chat-tools">
                          <button
                            className="icon-btn"
                            onClick={() => setChatMenuOpen((open) => !open)}
                            aria-label="More options"
                          >
                            <MoreHorizontal size={19} />
                          </button>
                          {chatMenuOpen && <div className="chat-menu" role="menu">
                            <button role="menuitem" disabled={!friendIds.includes(activeContact.id)} onClick={removeFriend}>Remove friend</button>
                            <button role="menuitem" className="danger-option" onClick={blockContact}>{blockedIds.includes(activeContact.id) ? "Unblock" : "Block"}</button>
                            <button role="menuitem" className="danger-option" onClick={reportContact}>Report</button>
                          </div>}
                        </div>
                      </header>
                      <div className="messages-area">
                        <div className="message-date">
                          <span /> TODAY <span />
                        </div>
                        {(messages[activeId ?? ""] ?? []).map((message) => (
                          <div
                            key={message.id}
                            className={`message-line ${message.own ? "message-own" : ""}`}
                          >
                            {!message.own && (
                              <Avatar
                                name={activeContact.name}
                                color={activeContact.color}
                                size="small"
                              />
                            )}
                            <div className="message-body">
                              <div className="message-bubble">
                                {message.text}
                              </div>
                              <span className="message-time">
                                {message.time}
                                {message.queued && " · delivers when they’re online"}
                                {message.own && <Check size={12} />}
                              </span>
                            </div>
                          </div>
                        ))}
                        <div ref={endRef} />
                      </div>
                      <div className="composer-row">
                      <button type="button" className="composer-new-chat" onClick={beginNewChat} aria-label="Start a new chat"><Plus size={15} /><span>New chat</span></button>
                      <form className="composer" onSubmit={sendMessage}>
                        <button
                          type="button"
                          className="composer-plus"
                          onClick={() =>
                            setNotice("Photo sharing is coming soon.")
                          }
                          aria-label="Add attachment"
                        >
                          <Plus size={20} />
                        </button>
                        <input
                          value={draft}
                          onChange={(e) => {
                            setDraft(e.target.value);
                            notifyTyping();
                          }}
                          placeholder={blockedIds.includes(activeContact.id) ? "Unblock this person to send a message" : `Write to ${activeContact.name.split(" ")[0]}…`}
                          aria-label="Message"
                          disabled={blockedIds.includes(activeContact.id)}
                        />
                        <span className="composer-hint">↵ to send</span>
                        <button
                          className="send-btn"
                          disabled={!draft.trim() || blockedIds.includes(activeContact.id)}
                          aria-label="Send message"
                        >
                          <Send size={17} />
                        </button>
                      </form>
                      </div>
                      <p className="chat-safety">
                        <Shield size={12} />{" "}
                        {activeId === "stranger"
                          ? "Random chats are never saved. When it ends, it’s gone."
                          : activeContact.online
                            ? "Messages go straight to them. Nothing is stored."
                            : "They’re offline. Your message is held briefly and deleted as soon as they open it."}
                      </p>
                    </>
                  ) : (
                    <div className="chat-empty">
                      <div className="empty-icon">
                        <MessageCircle size={28} />
                      </div>
                      <span className="eyebrow">MAKE YOURSELF AT HOME</span>
                      <h2>
                        A good chat starts
                        <br />
                        with a little hello.
                      </h2>
                      <p>
                        Choose a conversation on the left
                        <br />
                        and pick up right where you left off.
                      </p>
                      <button
                        className="secondary-btn"
                        onClick={() => setMobileList(true)}
                      >
                        Browse conversations
                      </button>
                      <div className="empty-spark">✳</div>
                    </div>
                  )}
                </div>
              </section>
            )}
 
            {view === "random" && (
              <section className="discover-page">
                <div className="page-heading">
                  <span className="eyebrow">A SMALL WORLD, AFTER ALL</span>
                  <h1>
                    Someone new
                    <br />
                    is just a hello away.
                  </h1>
                  <p>
                    No profiles to scroll through. Just a real conversation, one
                    person at a time.
                  </p>
                </div>
                <div className="discover-card">
                  <div className="discover-visual">
                    <div className="discover-orbit" />
                    <div className="discover-bubble bubble-a">
                      <MessageCircle size={28} />
                    </div>
                    <div className="discover-bubble bubble-b">
                      <Users size={24} />
                    </div>
                    <div className="discover-center">
                      <img src={brandLogoSrc} alt="ChatTalker" />
                    </div>
                    <span className="discover-star star-a">✳</span>
                    <span className="discover-star star-b">✦</span>
                    <span className="discover-star star-c">✧</span>
                  </div>
                  <div className="discover-details">
                    <span className="eyebrow">RANDOM CHAT</span>
                    <h2>
                      Good things happen
                      <br />
                      when you say hello.
                    </h2>
                    <p>
                      We’ll introduce you to someone new. Stay curious, be kind,
                      and see where the conversation takes you.
                    </p>
                    <button
                      className="gender-choice"
                      onClick={() => setShowGender(true)}
                    >
                      <span>
                        <Users size={16} /> Match preference
                      </span>
                      <strong>
                        {gender}{" "}
                        <ChevronLeft className="arrow-right" size={16} />
                      </strong>
                    </button>
                    <button
                      className="primary-btn discover-start"
                      onClick={() => setShowGender(true)}
                    >
                      <MessageCircle size={17} /> Start chatting
                    </button>
                    <div className="discover-privacy">
                      <Shield size={14} /> You’re in control. Leave a chat
                      whenever you like.
                    </div>
                  </div>
                </div>
                <div className="discover-note">
                  <span>✳</span>
                  <p>Every stranger is a story you haven’t heard yet.</p>
                  <span>✳</span>
                </div>
              </section>
            )}
 
            {view === "profile" && (
              <section className="profile-page">
                <div className="profile-heading">
                  <span className="eyebrow">YOUR LITTLE CORNER</span>
                  <h1>Profile</h1>
                  <p>A few words about you make it easier to say hello.</p>
                </div>
                <div className="profile-card">
                  <div className="profile-cover">
                    <div className="cover-orb cover-one" />
                    <div className="cover-orb cover-two" />
                  </div>
                  <div className="profile-avatar-row">
                    <Avatar name={account.name} size="large" />
                    <div>
                      <h2>{account.name}</h2>
                      <span>@{account.username}</span>
                    </div>
                  </div>
                  {!editingProfile ? <div className="profile-overview">
                    <p>{account.bio || "Add a little about yourself to help people say hello."}</p>
                    <div className="profile-gender"><span>Gender</span><strong>{account.gender}</strong></div>
                    <div className="profile-actions"><button className="primary-btn" onClick={() => setEditingProfile(true)}>Edit profile</button><button className="profile-settings-btn" onClick={() => go("settings")}><Settings size={15} /> Settings</button></div>
                  </div> : <form className="profile-form" onSubmit={saveProfile}>
                    <label>
                      Display name
                      <input
                        id="profile-name"
                        value={account.name}
                        onChange={(e) =>
                          setAccount({ ...account, name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Username
                      <div className="input-prefix">
                        <span>@</span>
                        <input value={account.username} readOnly />
                      </div>
                    </label>
                    <label>
                      Your bio
                      <textarea
                        rows={3}
                        maxLength={160}
                        value={account.bio}
                        onChange={(e) =>
                          setAccount({ ...account, bio: e.target.value })
                        }
                        placeholder="A little about you…"
                      />
                      <span className="field-foot">
                        {account.bio.length}/160
                      </span>
                    </label>
                    <label>
                      Gender
                      <select
                        value={account.gender}
                        onChange={(e) =>
                          setAccount({ ...account, gender: e.target.value })
                        }
                      >
                        <option>Prefer not to say</option>
                        <option>Female</option>
                        <option>Male</option>
                        <option>Non-binary</option>
                        <option>Self-describe</option>
                      </select>
                      <span className="field-help">
                        Your gender is private and only used for matching if you
                        choose.
                      </span>
                    </label>
                    <div className="form-actions">
                      <button className="cancel-request-btn" type="button" onClick={() => { const saved = localStorage.getItem("ct-profile"); if (saved) { try { setAccount(JSON.parse(saved)); } catch { /* retain current draft */ } } setEditingProfile(false); }}>Cancel</button>
                      <button className="primary-btn" type="submit">
                        Save changes
                      </button>
                    </div>
                  </form>}
                </div>
              </section>
            )}
 
            {view === "contact-profile" && activeContact && (
              <section className="profile-page contact-profile-page">
                <button className="back-profile-btn" onClick={() => go("messages")}><ChevronLeft size={16} /> Back to chat</button>
                <div className="profile-card contact-profile-card">
                  <div className="profile-cover"><div className="cover-orb cover-one" /><div className="cover-orb cover-two" /></div>
                  <div className="profile-avatar-row"><Avatar name={activeContact.name} color={activeContact.color} size="large" online={activeContact.online} /><div><h2>{activeContact.name}</h2><span>@{activeContact.name}</span></div></div>
                  <div className="profile-overview"><p>{activeContact.gender === "Female" ? "Always happy to meet someone new and share a good conversation." : activeContact.gender === "Male" ? "Curious, friendly, and always up for a thoughtful chat." : "Here for kind conversations and new perspectives."}</p><div className="profile-gender"><span>Gender</span><strong>{activeContact.gender}</strong></div><div className="profile-actions">{friendIds.includes(activeContact.id) ? <span className="friend-status"><Check size={14} /> Friend</span> : sentRequests.includes(activeContact.id) ? <span className="pending-pill">Request sent</span> : <button className="primary-btn" onClick={() => sendFriendRequest(activeContact)}><UserPlus size={15} /> Add friend</button>}<button className="profile-settings-btn" onClick={() => go("messages")}><MessageCircle size={15} /> Message</button></div></div>
                </div>
              </section>
            )}
 
            {view === "settings" && (
              <section className="settings-page">
                <div className="profile-heading">
                  <span className="eyebrow">MAKE YOURSELF AT HOME</span>
                  <h1>Settings</h1>
                  <p>Small adjustments to make this feel like your space.</p>
                </div>
                <div className="settings-layout">
                  <nav className="settings-menu">
                    <button className="settings-menu-item selected">
                      <Settings size={17} /> Preferences
                    </button>
                    <button
                      className="settings-menu-item"
                      onClick={() => go("profile")}
                    >
                      <UserRound size={17} /> Your profile
                    </button>
                    <button
                      className="settings-menu-item"
                      onClick={() =>
                        setNotice("Your account is in good standing.")
                      }
                    >
                      <Shield size={17} /> Privacy & safety
                    </button>
                  </nav>
                  <div className="settings-content">
                    <section className="settings-section">
                      <div className="settings-section-icon">
                        <Sun size={18} />
                      </div>
                      <div className="settings-section-copy">
                        <h2>Appearance</h2>
                        <p>Choose the look that feels right to you.</p>
                        <div className="theme-options">
                          {[
                            { id: "system", label: "System", icon: Settings },
                            { id: "light", label: "Light", icon: Sun },
                            { id: "dark", label: "Dark", icon: Moon },
                          ].map(({ id, label, icon: Icon }) => (
                            <button
                              key={id}
                              className={`theme-choice ${theme === id ? "chosen" : ""}`}
                              onClick={() => saveTheme(id)}
                            >
                              <Icon size={16} />
                              <span>{label}</span>
                              {theme === id && <Check size={14} />}
                            </button>
                          ))}
                        </div>
                        <span className="field-help">
                          System follows your device appearance setting.
                        </span>
                      </div>
                    </section>
                    <div className="setting-divider" />
                    <section className="settings-section">
                      <div className="settings-section-icon">
                        <Users size={18} />
                      </div>
                      <div className="settings-section-copy">
                        <h2>Random chat</h2>
                        <p>
                          Set a matching preference before you meet someone new.
                        </p>
                        <button
                          className="gender-setting"
                          onClick={() => setShowGender(true)}
                        >
                          <span>Preferred gender</span>
                          <strong>
                            {gender}
                            <ChevronLeft className="arrow-right" size={15} />
                          </strong>
                        </button>
                        <span className="field-help">
                          You can change this anytime. The other person can’t
                          see your preference.
                        </span>
                      </div>
                    </section>
                    <div className="setting-divider" />
                    <section className="settings-section">
                      <div className="settings-section-icon">
                        <Bell size={18} />
                      </div>
                      <div className="settings-section-copy">
                        <h2>Notifications</h2>
                        <p>Keep up with the conversations that matter.</p>
                        <label className="toggle-row">
                          <span>New messages</span>
                          <input type="checkbox" defaultChecked />
                          <i />
                        </label>
                        <label className="toggle-row">
                          <span>Friend requests</span>
                          <input type="checkbox" defaultChecked />
                          <i />
                        </label>
                      </div>
                    </section>
                    <div className="setting-divider" />
                    <button
                      className="signout-row"
                        onClick={() => {
                        localStorage.removeItem("ct-token");
                        localStorage.removeItem("ct-profile");
                        localStorage.removeItem("ct-lastmsg");
                        myIdRef.current = null;
                        setFriends([]);
                        setOutgoing([]);
                        setBlockedPeople([]);
                        setNotifications([]);
                        setMessages({});
                        setUnreadIds([]);
                        setActiveId(null);
                        setStranger(null);
                        setBanner(null);
                        setIsAdmin(false);
                        setEditingBanner(false);
                        setView("welcome");
                      }}
                    >
                      <span>
                        <LogOut size={17} /> Sign out
                      </span>
                      <ChevronLeft size={16} className="arrow-right" />
                    </button>
                  </div>
                </div>
              </section>
            )}
          </main>
 
          <nav className="mobile-nav" aria-label="Mobile navigation">
            {nav.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={view === id ? "active" : ""}
                onClick={() => go(id)}
                aria-label={label}
              >
                <Icon size={20} />
                <span>{label}</span>
                {id === "messages" && unreadIds.length > 0 && <i className="nav-unread-dot" aria-label="Unread messages" />}
              </button>
            ))}
          </nav>
 
          {showGender && (
            <div
              className="modal-backdrop"
              onClick={closeGenderModal}
            >
              <section
                className="gender-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="gender-title"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="modal-close icon-btn"
                  onClick={closeGenderModal}
                  aria-label="Close"
                >
                  <X size={19} />
                </button>
                <div className="modal-icon">
                  <Users size={22} />
                </div>
                <span className="eyebrow">YOUR KIND OF CONNECTION</span>
                <h2 id="gender-title">
                  Who would you like
                  <br />
                  to meet?
                </h2>
                <p>
                  Choose who you’d like us to match you with. You can change
                  this whenever you like.
                </p>
                <div className="gender-options">
                  {["Any gender", "Female", "Male", "Non-binary"].map(
                    (option) => (
                      <button
                        key={option}
                        className={matchPreference === option ? "selected" : ""}
                        onClick={() => chooseGender(option)}
                      >
                        <span className="option-radio">
                          {matchPreference === option && <i />}
                        </span>
                        <span>{option}</span>
                        {option === "Any gender" && <small>Meet anyone</small>}
                      </button>
                    ),
                  )}
                </div>
                <button
                  className="primary-btn modal-start"
                  onClick={startMatching}
                  disabled={matching}
                >
                  {matching ? (
                    <>
                      <span className="loading-dots" /> Finding your person…
                    </>
                  ) : (
                    <>
                      Start chatting{" "}
                      <ChevronLeft className="arrow-right" size={16} />
                    </>
                  )}
                </button>
                <div className="modal-privacy">
                  <Shield size={13} /> Your preference stays private.
                </div>
              </section>
            </div>
          )}
          {searchOpen && (
            <div
              className="modal-backdrop"
              onClick={() => setSearchOpen(false)}
            >
              <section
                className="search-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Search conversations"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="search-modal-input">
                  <Search size={20} />
                  <input
                    autoFocus
                    placeholder="Search people or conversations…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Escape" && setSearchOpen(false)
                    }
                  />
                  <button
                    className="icon-btn"
                    onClick={() => setSearchOpen(false)}
                    aria-label="Close search"
                  >
                    <X size={18} />
                  </button>
                </div>
                <span className="eyebrow search-label">YOUR CONVERSATIONS</span>
                {filteredContacts.map((person) => (
                  <button
                    className="search-result"
                    key={person.id}
                    onClick={() => {
                      openChat(person.id);
                      setSearchOpen(false);
                    }}
                  >
                    <Avatar
                      name={person.name}
                      color={person.color}
                      online={person.online}
                    />
                    <span>
                      <strong>{person.name}</strong>
                      <small>{person.preview}</small>
                    </span>
                    <ChevronLeft className="arrow-right" size={16} />
                  </button>
                ))}
                {filteredContacts.length === 0 && (
                  <p className="search-empty">
                    No conversations match that search yet.
                  </p>
                )}
                {query.trim().length >= 2 && (
                  <>
                    <span className="eyebrow search-label">
                      PEOPLE ON CHATTALKER
                    </span>
                    {peopleLoading && <p className="search-empty">Searching…</p>}
                    {!peopleLoading &&
                      peopleResults.filter(
                        (p) =>
                          p.relation !== "friend" &&
                          !friendIds.includes(String(p.id)),
                      ).length === 0 && (
                        <p className="search-empty">
                          No new people found with that username.
                        </p>
                      )}
                    {peopleResults
                      .filter(
                        (p) =>
                          p.relation !== "friend" &&
                          !friendIds.includes(String(p.id)),
                      )
                      .map((p) => {
                        const pid = String(p.id);
                        const relation = sentRequests.includes(pid)
                          ? "sent"
                          : notifications.some((n) => n.id === pid)
                            ? "received"
                            : p.relation;
                        return (
                          <div className="search-result search-person" key={p.id}>
                            <Avatar name={p.username} color={colorFor(pid)} />
                            <span>
                              <strong>{p.username}</strong>
                              <small>@{p.username}</small>
                            </span>
                            {relation === "sent" ? (
                              <span className="pending-pill">Pending</span>
                            ) : relation === "received" ? (
                              <button
                                className="add-friend-btn"
                                onClick={() => respondToFriendRequest(pid, true)}
                              >
                                <Check size={13} /> Accept
                              </button>
                            ) : (
                              <button
                                className="add-friend-btn"
                                onClick={() =>
                                  sendFriendRequest(
                                    toPerson({ id: p.id, username: p.username }),
                                  )
                                }
                              >
                                <UserPlus size={13} /> Add friend
                              </button>
                            )}
                          </div>
                        );
                      })}
                  </>
                )}
                <div className="search-foot">
                  <kbd>ESC</kbd> to close{" "}
                  <span>
                    <kbd>↵</kbd> to open conversation
                  </span>
                </div>
              </section>
            </div>
          )}
          {notice && (
            <div className="toast">
              <span className="toast-check">
                <Check size={14} />
              </span>
              {notice}
              <button onClick={() => setNotice("")} aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
 