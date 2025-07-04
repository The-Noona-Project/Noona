# 🦅 Raven

**Raven** is the **manga downloader and scraper microservice** for the Noona project.  
It powers automatic searching, scraping, and downloading of manga chapters into organized `.cbz` files for your personal library.

---

## ✨ **What does Raven do?**

✅ Provides an **API to search and download manga** from supported sources (currently [WeebCentral](https://weebcentral.com))  
✅ Organizes downloaded chapters into a clean, structured library  
✅ Uses **headless Selenium & Jsoup** for scraping  
✅ Integrates seamlessly as the dedicated scraper within the Noona ecosystem  
✅ Names chapters dynamically with **page count, source domain, and powered by Noona**

---

## 🔄 **Download Flow**

1. **Search**

   - Client calls `/v1/download/search/{titleName}`
   - Raven scrapes WeebCentral for matching titles using Selenium + Jsoup

2. **Select**

   - Client selects a title by index via `/v1/download/select/{searchId}/{optionIndex}`
   - Raven retrieves the URL, finds chapters, and initiates download

3. **Download**

   - For each chapter:
     - Scrapes and downloads all pages
     - Packages them into a `.cbz` archive with clean naming:
       ```
       Chapter {Number} [Pages {Count} {Source} - Noona].cbz
       ```
   - Adds the title & chapter to the local library

---

## 🔗 **API Endpoints**

| Method | Endpoint                                             | Description                                                                       |
| ------ | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| GET    | `/v1/download/health`                                | Health check for the download module.                                             |
| GET    | `/v1/download/search/{titleName}`                    | Search WeebCentral for a manga title. Returns options and a generated `searchId`. |
| GET    | `/v1/download/select/{searchId}/{optionIndex}`       | Download all chapters from a previously searched title.                           |
| GET    | `/v1/library/health`                                 | Health check for the library module.                                              |
| GET    | `/v1/library/getall`                                 | Get all titles currently in the library.                                          |
| GET    | `/v1/library/get/{titleName}`                        | Get details of a specific title by name.                                          |

---

## 📁 **Download Output Example**

Downloaded files are saved under:

````

/downloads/{Title}/Chapter {Number} \[Pages {Count} from {Source} - Noona].cbz

```

For example:

```

Chapter 120 [Pages 34 hot.planeptune.us - Noona].cbz

```

---

## 🗂️ **Project Structure**

Example folder tree (`tree /f` in `services/raven`):

```

C:.
│   build.gradle
│   gradlew
│   gradlew\.bat
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
│   │   └───com.paxkun.raven
│   │       │   RavenApplication.java
│   │       ├───controller
│   │       │       DownloadController.java
│   │       │       LibraryController.java
│   │       └───service
│   │           │   DownloadService.java
│   │           │   LibraryService.java
│   │           ├───download
│   │           │       DownloadChapter.java
│   │           │       SearchTitle.java
│   │           │       SourceFinder.java
│   │           │       TitleScraper.java
│   │           └───library
│   │                   NewChapter.java
│   │                   NewTitle.java
│   └───resources
│       │   application.properties
└───test
└───java.com.paxkun.raven
RavenApplicationTests.java

````

---

## 🚀 **Running Raven**

### 🛠️ **Prerequisites**
 
- Docker Desktop

---

### 🔧 **Build**
From project root:
```bash
docker build --no-cache -f deployment/raven.Dockerfile -t captainpax/noona-raven . 
````

### ▶️ **Run Locally**
From project root:
```bash
docker run -p 8080:8080 `                                        
>>   -v ${env:APPDATA}:/app/downloads `
>>   captainpax/noona-raven
```

### ✅ **Verify health**

Visit:

* [http://localhost:8080/v1/download/health](http://localhost:8080/v1/download/health)
* [http://localhost:8080/v1/library/health](http://localhost:8080/v1/library/health)

You should see:

```
Raven Download API is up and running!
Raven Library API is up and running!
```

---

## 📝 **Notes**

* Logs are saved under `/downloads/logs` with automatic rotation.
* Uses **headless Chrome with Selenium**; ensure your environment supports it.
* Future enhancements:

   * Volume packaging into volume-level CBZ files
   * Persistent database integration for the library

---

### 👤 **Maintained by Pax**

🚀 *Powered by Noona.*
