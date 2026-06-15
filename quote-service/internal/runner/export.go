package runner

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"

	"quote-service/internal/quote"

	"github.com/xuri/excelize/v2"
)

type ExportOptions struct {
	OutputPath string
	Mode       string
	Lang       string
}

func RunExport(opts ExportOptions) {
	var snap quote.Snapshot
	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		log.Fatalf("Failed to read stdin: %v", err)
	}
	if err := json.Unmarshal(data, &snap); err != nil {
		log.Fatalf("Failed to parse JSON: %v", err)
	}

	f := excelize.NewFile()
	defer f.Close()

	quote.WriteExcel(f, &snap, opts.Mode, opts.Lang)

	if err := f.SaveAs(opts.OutputPath); err != nil {
		log.Fatalf("Failed to save excel: %v", err)
	}
	fmt.Fprintf(os.Stderr, "已生成 %s 版报价单：%s\n", opts.Mode, opts.OutputPath)
}
