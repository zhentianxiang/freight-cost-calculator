package archive

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"quote-service/internal/quote"
)

type FileStore struct {
	Dir string
}

type Summary struct {
	ID          string `json:"id"`
	ProjectName string `json:"projectName"`
	Destination string `json:"destination"`
	Label       string `json:"label"`
	UpdatedAt   string `json:"updatedAt"`
}

func NewFileStore(dir string) *FileStore {
	return &FileStore{Dir: dir}
}

func (s *FileStore) Init() error {
	if err := os.MkdirAll(s.Dir, 0755); err != nil {
		return err
	}
	return os.MkdirAll(s.ImageDir(), 0755)
}

func (s *FileStore) Save(snap quote.Snapshot) error {
	quote.FixDefaults(&snap)
	if snap.ID == "" {
		snap.ID = fmt.Sprintf("%d", os.Getpid())
	}
	data, err := json.Marshal(snap)
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
		var snap struct {
			ID        string       `json:"id"`
			Label     string       `json:"label"`
			UpdatedAt string       `json:"updatedAt"`
			Inputs    quote.Inputs `json:"inputs"`
		}
		if err := json.Unmarshal(data, &snap); err == nil {
			list = append(list, Summary{
				ID:          snap.ID,
				ProjectName: snap.Inputs.ProjectName,
				Destination: snap.Inputs.Destination,
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

func (s *FileStore) ImageDir() string {
	return filepath.Join(s.Dir, "images")
}

func (s *FileStore) SaveImage(name, dataURL string) (string, string, error) {
	ext, payload, ok := splitImageData(dataURL)
	if !ok {
		return "", "", fmt.Errorf("invalid image data")
	}
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", "", err
	}
	if len(raw) > 8*1024*1024 {
		return "", "", fmt.Errorf("image too large")
	}
	base := strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))
	if base == "" {
		base = "cargo"
	}
	filename := safeID(base) + "-" + fmt.Sprintf("%d", time.Now().UnixNano()) + ext
	path := filepath.Join(s.ImageDir(), filename)
	if err := os.WriteFile(path, raw, 0644); err != nil {
		return "", "", err
	}
	return filename, "/api/images/" + filename, nil
}

func (s *FileStore) ImagePath(name string) string {
	return filepath.Join(s.ImageDir(), safeImageName(name))
}

func (s *FileStore) UpdateLabel(id, label string) (quote.Snapshot, error) {
	data, err := s.Load(id)
	if err != nil {
		return quote.Snapshot{}, err
	}
	var snap quote.Snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return quote.Snapshot{}, err
	}
	snap.Label = strings.TrimSpace(label)
	if err := s.Save(snap); err != nil {
		return quote.Snapshot{}, err
	}
	return snap, nil
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

func safeImageName(name string) string {
	name = filepath.Base(name)
	return strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			return r
		}
		return '_'
	}, name)
}

func splitImageData(data string) (string, string, bool) {
	parts := strings.SplitN(data, ",", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	header := strings.ToLower(parts[0])
	ext := ".jpg"
	switch {
	case strings.Contains(header, "image/png"):
		ext = ".png"
	case strings.Contains(header, "image/gif"):
		ext = ".gif"
	case strings.Contains(header, "image/webp"):
		ext = ".webp"
	case strings.Contains(header, "image/jpeg"), strings.Contains(header, "image/jpg"):
		ext = ".jpg"
	default:
		return "", "", false
	}
	return ext, parts[1], true
}
