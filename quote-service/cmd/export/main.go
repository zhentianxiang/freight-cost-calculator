package main

import (
	"flag"

	"quote-service/internal/runner"
)

func main() {
	opts := runner.ExportOptions{}
	flag.StringVar(&opts.OutputPath, "output", "output.xlsx", "output xlsx path")
	flag.StringVar(&opts.Mode, "mode", "internal", "customer or internal")
	flag.StringVar(&opts.Lang, "lang", "zh", "zh, en, or bilingual")
	flag.Parse()

	runner.RunExport(opts)
}
