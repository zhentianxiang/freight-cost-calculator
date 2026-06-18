package httpapi

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"sync/atomic"
	"time"

	"quote-service/internal/archive"
	"quote-service/internal/pi"
	"quote-service/internal/quote"

	"github.com/xuri/excelize/v2"
)

type Server struct {
	store     *archive.FileStore
	requestID uint64
}

func NewServer(store *archive.FileStore) *Server {
	return &Server{store: store}
}

func Start(addr, storageDir string) error {
	store := archive.NewFileStore(storageDir)
	if err := store.Init(); err != nil {
		return err
	}
	log.Printf("quote-service 服务器启动于 %s", addr)
	return http.ListenAndServe(addr, NewServer(store).Routes())
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/quote/calculate", s.handleQuoteCalculate)
	mux.HandleFunc("/api/export", s.handleExport)
	mux.HandleFunc("/api/export/markdown", s.handleMarkdownExport)
	mux.HandleFunc("/api/save", s.handleSave)
	mux.HandleFunc("/api/list", s.handleList)
	mux.HandleFunc("/api/load", s.handleLoad)
	mux.HandleFunc("/api/delete", s.handleDelete)
	mux.HandleFunc("/api/update-label", s.handleUpdateLabel)
	mux.HandleFunc("/api/pi/export", s.handlePIExport)
	return s.logRequests(mux)
}

type responseLogWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *responseLogWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *responseLogWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	n, err := w.ResponseWriter.Write(data)
	w.bytes += n
	return n, err
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := atomic.AddUint64(&s.requestID, 1)
		start := time.Now()
		lw := &responseLogWriter{ResponseWriter: w}
		remote := clientIP(r)
		log.Printf("request start id=%d method=%s path=%s query=%q remote=%s user_agent=%q",
			id, r.Method, r.URL.Path, r.URL.RawQuery, remote, r.UserAgent())
		defer func() {
			if recovered := recover(); recovered != nil {
				log.Printf("request panic id=%d method=%s path=%s error=%v", id, r.Method, r.URL.Path, recovered)
				http.Error(lw, "Internal Server Error", http.StatusInternalServerError)
			}
			status := lw.status
			if status == 0 {
				status = http.StatusOK
			}
			log.Printf("request finish id=%d method=%s path=%s status=%d bytes=%d duration=%s remote=%s",
				id, r.Method, r.URL.Path, status, lw.bytes, time.Since(start), remote)
		}()
		next.ServeHTTP(lw, r)
	})
}

func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		return forwarded
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func (s *Server) handleQuoteCalculate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var snap quote.Snapshot
	if err := json.NewDecoder(r.Body).Decode(&snap); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	result := quote.Calculate(&snap)
	log.Printf("quote calculated project=%q term=%s cargo_rows=%d freight_rows=%d goods_cost=%.2f selected_scheme=%s quote_rmb=%.2f quote_usd=%.2f margin=%.2f",
		result.Inputs.ProjectName, result.Inputs.TradeTerm, len(snap.Cargo), len(snap.Freight), result.GoodsCost,
		result.Selected.Scheme, result.Selected.QuoteRmb, result.Selected.QuoteUsd, result.Selected.Margin)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing ID", http.StatusBadRequest)
		log.Printf("archive delete rejected missing_id=true")
		return
	}
	if err := s.store.Delete(id); err != nil {
		http.Error(w, "Failed to delete", http.StatusInternalServerError)
		log.Printf("archive delete failed id=%q error=%v", id, err)
		return
	}
	log.Printf("archive deleted id=%q", id)
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "Deleted")
}

func (s *Server) handleUpdateLabel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var request struct {
		ID    string `json:"id"`
		Label string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		log.Printf("archive label update rejected invalid_json=true error=%v", err)
		return
	}
	if request.ID == "" {
		http.Error(w, "Missing ID", http.StatusBadRequest)
		log.Printf("archive label update rejected missing_id=true")
		return
	}
	if len([]rune(request.Label)) > 200 {
		http.Error(w, "Label too long", http.StatusBadRequest)
		log.Printf("archive label update rejected id=%q label_too_long=true", request.ID)
		return
	}
	snap, err := s.store.UpdateLabel(request.ID, request.Label)
	if err != nil {
		http.Error(w, "Failed to update label", http.StatusInternalServerError)
		log.Printf("archive label update failed id=%q error=%v", request.ID, err)
		return
	}
	log.Printf("archive label updated id=%q label=%q", snap.ID, snap.Label)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"label":     snap.Label,
		"updatedAt": snap.UpdatedAt,
	})
}

func (s *Server) handleSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var snap quote.Snapshot
	if err := json.NewDecoder(r.Body).Decode(&snap); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		log.Printf("archive save rejected invalid_json=true error=%v", err)
		return
	}
	if err := s.store.Save(snap); err != nil {
		http.Error(w, "Failed to save", http.StatusInternalServerError)
		log.Printf("archive save failed id=%q project=%q error=%v", snap.ID, snap.Inputs.ProjectName, err)
		return
	}
	log.Printf("archive saved id=%q label=%q project=%q cargo_rows=%d freight_rows=%d",
		snap.ID, snap.Label, snap.Inputs.ProjectName, len(snap.Cargo), len(snap.Freight))
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "Saved")
}

func (s *Server) handleList(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.List()
	if err != nil {
		http.Error(w, "Failed to read storage", http.StatusInternalServerError)
		log.Printf("archive list failed error=%v", err)
		return
	}
	log.Printf("archive listed count=%d", len(list))
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(list)
}

func (s *Server) handleLoad(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "Missing ID", http.StatusBadRequest)
		log.Printf("archive load rejected missing_id=true")
		return
	}
	data, err := s.store.Load(id)
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		log.Printf("archive load failed id=%q error=%v", id, err)
		return
	}
	log.Printf("archive loaded id=%q bytes=%d", id, len(data))
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func (s *Server) handleMarkdownExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var snap quote.Snapshot
	if err := json.NewDecoder(r.Body).Decode(&snap); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		log.Printf("markdown export rejected invalid_json=true error=%v", err)
		return
	}
	mode := r.URL.Query().Get("mode")
	lang := r.URL.Query().Get("lang")
	content := quote.BuildMarkdown(&snap, mode, lang)
	log.Printf("markdown exported project=%q mode=%s lang=%s bytes=%d", snap.Inputs.ProjectName, mode, lang, len(content))
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=quotation.md")
	fmt.Fprint(w, content)
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var snap quote.Snapshot
	if err := json.NewDecoder(r.Body).Decode(&snap); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		log.Printf("excel export rejected invalid_json=true error=%v", err)
		return
	}

	f := excelize.NewFile()
	defer f.Close()

	mode := r.URL.Query().Get("mode")
	lang := r.URL.Query().Get("lang")
	quote.WriteExcel(f, &snap, mode, lang)
	log.Printf("excel export generated project=%q mode=%s lang=%s cargo_rows=%d freight_rows=%d",
		snap.Inputs.ProjectName, mode, lang, len(snap.Cargo), len(snap.Freight))

	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", "attachment; filename=quotation.xlsx")
	if err := f.Write(w); err != nil {
		http.Error(w, "Failed to generate Excel", http.StatusInternalServerError)
		log.Printf("excel export write failed project=%q error=%v", snap.Inputs.ProjectName, err)
	}
}

func (s *Server) handlePIExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var inv pi.Invoice
	if err := json.NewDecoder(r.Body).Decode(&inv); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		log.Printf("pi export rejected invalid_json=true error=%v", err)
		return
	}

	f := excelize.NewFile()
	defer f.Close()

	pi.WriteExcel(f, &inv)
	log.Printf("pi export generated pi_no=%q buyer=%q currency=%s item_rows=%d",
		inv.PINo, inv.Buyer.Company, inv.Currency, len(inv.Items))

	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", "attachment; filename=proforma-invoice.xlsx")
	if err := f.Write(w); err != nil {
		http.Error(w, "Failed to generate PI Excel", http.StatusInternalServerError)
		log.Printf("pi export write failed pi_no=%q error=%v", inv.PINo, err)
	}
}
