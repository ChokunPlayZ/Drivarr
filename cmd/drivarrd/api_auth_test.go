package main

import (
	"testing"
	"time"
)

func TestSessionCookiePersistsAcrossBrowserRefresh(t *testing.T) {
	before := time.Now().UTC()
	cookie := newSessionCookie("token", true)

	if cookie.Path != "/" || !cookie.HttpOnly || !cookie.Secure {
		t.Fatalf("unexpected cookie scope or security flags: %#v", cookie)
	}
	if cookie.MaxAge != 12*60*60 {
		t.Fatalf("MaxAge = %d, want %d", cookie.MaxAge, 12*60*60)
	}
	if cookie.Expires.Before(before.Add(11*time.Hour + 59*time.Minute)) {
		t.Fatalf("Expires = %s, want a persistent 12-hour cookie", cookie.Expires)
	}
}
