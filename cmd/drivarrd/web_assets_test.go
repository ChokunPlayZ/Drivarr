package main

import (
	"regexp"
	"strings"
	"testing"
)

func TestFrontendListenerTargetsExist(t *testing.T) {
	listenerTarget := regexp.MustCompile(`\$\("#([a-zA-Z0-9_-]+)"\)(?:\.|\?\.)addEventListener`)
	for _, match := range listenerTarget.FindAllStringSubmatch(appJS, -1) {
		id := match[1]
		if !strings.Contains(indexHTML, `id="`+id+`"`) {
			t.Errorf("app.js registers a listener on missing element #%s", id)
		}
	}
}
