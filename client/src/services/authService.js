// Talks to the /api/auth REST routes. Token is kept in memory only (no
// localStorage — see the artifact browser-storage restriction) so a page
// refresh returns you to guest mode; that's an acceptable trade-off for
// this MVP and is called out in the README as a Phase-4 follow-up (a
// proper httpOnly-cookie session would survive refreshes).

let authToken = null;
let currentUser = null; // { id, username, ... } | { username, isGuest: true }

async function request(path, body) {
  const res = await fetch(`/api/auth${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || "Request failed");
  return data;
}

export async function register(username, email, password) {
  const data = await request("/register", { username, email, password });
  authToken = data.token;
  currentUser = data.user;
  return currentUser;
}

export async function login(email, password) {
  const data = await request("/login", { email, password });
  authToken = data.token;
  currentUser = data.user;
  return currentUser;
}

export async function continueAsGuest(username) {
  const data = await request("/guest", { username });
  authToken = data.token;
  currentUser = data.user;
  return currentUser;
}

export function getCurrentUser() {
  return currentUser;
}

export function getAuthToken() {
  return authToken;
}

export function isGuest() {
  return !currentUser || currentUser.isGuest === true;
}

export function logout() {
  authToken = null;
  currentUser = null;
}

async function authedGet(path) {
  const res = await fetch(`/api/auth${path}`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || "Request failed");
  return data;
}

export async function getFriends() {
  if (isGuest()) return { friends: [], pending: [] };
  return authedGet("/friends");
}

export async function sendFriendRequest(username) {
  return request("/friends/request", { username });
}

export async function acceptFriendRequest(fromUserId) {
  return request("/friends/accept", { fromUserId });
}

export async function removeFriend(friendId) {
  return request("/friends/remove", { friendId });
}
