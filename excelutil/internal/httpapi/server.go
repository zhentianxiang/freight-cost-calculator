package httpapi

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"excelutil/internal/archive"
	"excelutil/internal/quote"

	"github.com/xuri/excelize/v2"
)

type Server struct {
	store *archive.FileStore
}

func NewServer(store *archive.FileStore) *Server {
	return &Server{store: store}
}

func Start(addr, storageDir string) error {
	store := archive.NewFileStore(storageDir)
	if err := store.Init(); err != nil {
		return err
	}
	log.Printf("excelutil 服务器启动于 %s", addr)
	return http.ListenAndServe(addr, NewServer(store).Routes())
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/export", s.handleExport)
	mux.HandleFunc("/api/save", s.handleSave)
	mux.HandleFunc("/api/list", s.handleList)
	mux.HandleFunc("/api/load", s.handleLoad)
	mux.HandleFunc("/api/delete", s.handleDelete)
	return mux
}

func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing ID", http.StatusBadRequest)
		return
	}
	if err := s.store.Delete(id); err != nil {
		http.Error(w, "Failed to delete", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "Deleted")
}

func (s *Server) handleSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var snap quote.Snapshot
	if err := json.NewDecoder(r.Body).Decode(&snap); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if err := s.store.Save(snap); err != nil {
		http.Error(w, "Failed to save", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "Saved")
}

func (s *Server) handleList(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.List()
	if err != nil {
		http.Error(w, "Failed to read storage", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleLoad(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing ID", http.StatusBadRequest)
		return
	}
	data, err := s.store.Load(id)
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var snap quote.Snapshot
	if err := json.NewDecoder(r.Body).Decode(&snap); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	f := excelize.NewFile()
	defer f.Close()

	quote.WriteExcel(f, &snap, r.URL.Query().Get("mode"), r.URL.Query().Get("lang"))

	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", "attachment; filename=quotation.xlsx")
	if err := f.Write(w); err != nil {
		http.Error(w, "Failed to generate Excel", http.StatusInternalServerError)
	}
}
