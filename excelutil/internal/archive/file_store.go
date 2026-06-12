package archive

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"excelutil/internal/quote"
)

type FileStore struct {
	Dir string
}

type Summary struct {
	ID          string `json:"id"`
	ProjectName string `json:"projectName"`
	Label       string `json:"label"`
	UpdatedAt   string `json:"updatedAt"`
}

func NewFileStore(dir string) *FileStore {
	return &FileStore{Dir: dir}
}

func (s *FileStore) Init() error {
	return os.MkdirAll(s.Dir, 0755)
}

func (s *FileStore) Save(snap quote.Snapshot) error {
	quote.FixDefaults(&snap)
	if snap.ID == "" {
		snap.ID = fmt.Sprintf("%d", os.Getpid())
	}
	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path(snap.ID), data, 0644)
}

func (s *FileStore) List() ([]Summary, error) {
	files, err := os.ReadDir(s.Dir)
	if err != nil {
		return nil, err
	}

	var list []Summary
	for _, f := range files {
		if !strings.HasSuffix(f.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(s.Dir + "/" + f.Name())
		if err != nil {
			continue
		}
		var snap quote.Snapshot
		if err := json.Unmarshal(data, &snap); err == nil {
			list = append(list, Summary{
				ID:          snap.ID,
				ProjectName: snap.Inputs.ProjectName,
				Label:       snap.Label,
				UpdatedAt:   snap.UpdatedAt,
			})
		}
	}
	return list, nil
}

func (s *FileStore) Load(id string) ([]byte, error) {
	return os.ReadFile(s.path(id))
}

func (s *FileStore) Delete(id string) error {
	return os.Remove(s.path(id))
}

func (s *FileStore) path(id string) string {
	return fmt.Sprintf("%s/%s.json", s.Dir, safeID(id))
}

func safeID(id string) string {
	return strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, id)
}
