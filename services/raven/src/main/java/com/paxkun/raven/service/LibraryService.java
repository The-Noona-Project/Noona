package com.paxkun.raven.service;

import com.paxkun.raven.service.library.NewChapter;
import com.paxkun.raven.service.library.NewTitle;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * LibraryService manages Raven's local manga library.
 * Provides operations to add titles and chapters, retrieve titles, and chapters by title.
 * Replace in-memory storage with real database integration later.
 *
 * Author: Pax
 */
@Service
public class LibraryService {

    @Autowired
    private LoggerService logger;

    // In-memory store for demonstration purposes
    private final Map<String, List<NewChapter>> library = new HashMap<>();

    /**
     * Adds a new title with its initial chapter to the library.
     *
     * @param title   the manga title object
     * @param chapter the initial chapter object
     */
    public void addTitleWithChapter(NewTitle title, NewChapter chapter) {
        library.computeIfAbsent(title.getTitleName(), k -> new ArrayList<>()).add(chapter);
        logger.info("LIBRARY", "📚 Added chapter [" + chapter.getChapter() + "] to title [" + title.getTitleName() + "]");
    }

    /**
     * Retrieves all titles in the library as NewTitle objects.
     *
     * @return list of NewTitle
     */
    public List<NewTitle> getAllTitleObjects() {
        List<NewTitle> titles = new ArrayList<>();
        for (String titleName : library.keySet()) {
            titles.add(new NewTitle(titleName));
        }
        logger.info("LIBRARY", "🔍 Retrieved " + titles.size() + " titles from library.");
        return titles;
    }

    /**
     * Retrieves a specific title by name.
     *
     * @param titleName the manga title
     * @return NewTitle object or null if not found
     */
    public NewTitle getTitle(String titleName) {
        if (library.containsKey(titleName)) {
            logger.info("LIBRARY", "✅ Title found: " + titleName);
            return new NewTitle(titleName);
        }
        logger.warn("LIBRARY", "⚠️ Title not found: " + titleName);
        return null;
    }

    /**
     * Retrieves all chapters downloaded for a given title.
     *
     * @param titleName the manga title
     * @return list of chapters for that title
     */
    public List<NewChapter> getChaptersByTitle(String titleName) {
        List<NewChapter> chapters = library.getOrDefault(titleName, new ArrayList<>());
        logger.info("LIBRARY", "📄 Retrieved " + chapters.size() + " chapters for title [" + titleName + "]");
        return chapters;
    }
}
