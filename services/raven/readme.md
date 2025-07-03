# 🦉 Raven

Raven is the **manga downloader and scraper microservice** for the Noona project. It powers automatic searching, scraping, and downloading of manga chapters into organized CBZ files for your personal library.

---

## ✨ **Goal of Raven**

Raven's goal is to:

* Provide an **API to search and download manga** from supported sources (currently [WeebCentral](https://weebcentral.com)).
* Organize downloaded chapters into a structured library.
* Integrate seamlessly with the Noona ecosystem as its dedicated scraper service.

---

## 🔄 **Download Flow**

1. **Search**

    * Client calls `/v1/download/search/{titleName}`
    * Raven uses Selenium & Jsoup to scrape WeebCentral for matching titles.

2. **Select**

    * Client selects a title by index via `/v1/download/select/{searchId}/{optionIndex}`
    * Raven retrieves the correct URL, finds chapter images, and begins download.

3. **Download**

    * Raven scrapes available chapter images.
    * Downloads them into a `.cbz` file saved under a structured folder by title.
    * Adds the title & chapter to the local library for retrieval.

---

## 🔗 **API Endpoints**

| Method | Endpoint                                             | Description                                                                       |
| ------ | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| GET    | `/v1/download/health`                                | Health check for the download module.                                             |
| GET    | `/v1/download/search/{titleName}`                    | Search WeebCentral for a manga title. Returns options and a generated `searchId`. |
| POST   | `/v1/download/search/{searchId}?optionIndex={index}` | Download a chapter from a previously searched title.                              |
| GET    | `/v1/library/health`                                 | Health check for the library module.                                              |
| GET    | `/v1/library/getall`                                 | Get all titles currently in the library.                                          |
| GET    | `/v1/library/get/{titleName}`                        | Get details of a specific title by name.                                          |

---

## 📁 **Project Structure**

Example Windows folder path output (run `tree /f` in `services/raven`):

```
C:.
│   build.gradle
│   gradlew
│   gradlew.bat
│   settings.gradle
│
├───gradle
│   └───wrapper
│           gradle-wrapper.jar
│           gradle-wrapper.properties
│
└───src
    ├───main
    │   ├───java
    │   │   └───com
    │   │       └───paxkun
    │   │           └───raven
    │   │               │   RavenApplication.java
    │   │               │
    │   │               ├───controller
    │   │               │       DownloadController.java
    │   │               │       LibraryController.java
    │   │               │
    │   │               └───service
    │   │                   │   DownloadService.java
    │   │                   │   LibraryService.java
    │   │                   │
    │   │                   ├───download
    │   │                   │       DownloadChapter.java
    │   │                   │       SearchTitle.java
    │   │                   │       SourceFinder.java
    │   │                   │       TitleScraper.java
    │   │                   │
    │   │                   └───library
    │   │                           NewChapter.java
    │   │                           NewTitle.java
    │   │
    │   └───resources
    │       │   application.properties
    │
    └───test
        └───java
            └───com
                └───paxkun
                    └───raven
                            RavenApplicationTests.java
```

---

## 🚀 **Building and Running Raven**

### **🛠️ Prerequisites**

* JDK 21
* [Gradle](https://gradle.org/) (or use `./gradlew`)
* Docker (if running in container)

---

### **🔧 Build**

```bash
cd services/raven
./gradlew build
```

Or on Windows:

```powershell
cd services\raven
.\gradlew.bat build
```

---

### **▶️ Run Locally**

```bash
./gradlew bootRun
```

Or with Docker (from project root):

```bash
docker build -f deployment/raven.Dockerfile -t captainpax/noona-raven .
docker run -p 8080:8080 `
  -v ${env:APPDATA}\Noona\raven:/app/downloads `
  captainpax/noona-raven
```

---

### ✅ **Verify health**

Open:

* [http://localhost:8080/v1/download/health](http://localhost:8080/v1/download/health)
* [http://localhost:8080/v1/library/health](http://localhost:8080/v1/library/health)

You should see **“Raven Download API is up and running!”** and **“Raven Library API is up and running!”**

---

### 📝 **Notes**

* Downloaded CBZ files are saved under `/downloads/{title}/{chapter}.cbz`.
* Future enhancements will integrate a persistent database instead of in-memory storage.

---


