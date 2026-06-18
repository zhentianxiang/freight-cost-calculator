package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"quote-service/internal/archive"
	"quote-service/internal/quote"
)

func TestUpdateArchiveLabel(t *testing.T) {
	store := archive.NewFileStore(t.TempDir())
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	original := quote.Snapshot{
		ID:        "quote-1",
		Label:     "服务器归档",
		UpdatedAt: "2026-06-18T08:00:00Z",
		Inputs:    quote.Inputs{ProjectName: "测试客户"},
		Cargo:     []quote.CargoRow{{Name: "测试货物", Qty: 2, UnitPrice: 100}},
	}
	if err := store.Save(original); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{"id": original.ID, "label": "  已确认报价  "})
	request := httptest.NewRequest(http.MethodPost, "/api/update-label", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	NewServer(store).Routes().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	data, err := store.Load(original.ID)
	if err != nil {
		t.Fatal(err)
	}
	var updated quote.Snapshot
	if err := json.Unmarshal(data, &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Label != "已确认报价" {
		t.Fatalf("expected updated label, got %q", updated.Label)
	}
	if updated.UpdatedAt != original.UpdatedAt {
		t.Fatalf("archive time changed: got %q", updated.UpdatedAt)
	}
	if len(updated.Cargo) != 1 || updated.Cargo[0].Name != original.Cargo[0].Name {
		t.Fatalf("archive content changed unexpectedly: %#v", updated.Cargo)
	}
}
