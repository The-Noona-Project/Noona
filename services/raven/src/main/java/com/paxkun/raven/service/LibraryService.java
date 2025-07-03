package com.paxkun.raven.service;

import com.paxkun.raven.service.library.NewChapter;
import com.paxkun.raven.service.library.NewTitle;
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
 * @author Pax
 */
@Service
public class LibraryService {

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
            return new NewTitle(titleName);
        }
        return null;
    }

    /**
     * Retrieves all chapters downloaded for a given title.
     *
     * @param titleName the manga title
     * @return list of chapters for that title
     */
    public List<NewChapter> getChaptersByTitle(String titleName) {
        return library.getOrDefault(titleName, new ArrayList<>());
    }
}
