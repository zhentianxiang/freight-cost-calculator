package main

import (
	"log"

	"quote-service/internal/httpapi"
)

func main() {
	if err := httpapi.Start(":8080", "./data"); err != nil {
		log.Fatal(err)
	}
}
