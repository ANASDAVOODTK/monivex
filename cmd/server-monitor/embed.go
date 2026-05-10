package main

import (
	"embed"
	"io/fs"
)

//go:embed all:web-out
var uiEmbed embed.FS

func init() {
	uiFromMain = func() fs.FS {
		sub, err := fs.Sub(uiEmbed, "web-out")
		if err != nil {
			return nil
		}
		entries, err := fs.ReadDir(sub, ".")
		if err != nil || len(entries) == 0 {
			return nil
		}
		// Skip if only the placeholder file is present.
		if len(entries) == 1 && entries[0].Name() == ".gitkeep" {
			return nil
		}
		return sub
	}
}
