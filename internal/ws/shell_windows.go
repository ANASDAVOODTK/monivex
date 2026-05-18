//go:build windows

package ws

import "net/http"

// HandleShell is a stub on Windows. Adding ConPTY support is tracked
// separately; for now, agents running on Windows return 501.
func (s *Server) HandleShell(w http.ResponseWriter, r *http.Request) {
	http.Error(w, "host shell is not supported on Windows agents", http.StatusNotImplemented)
}
