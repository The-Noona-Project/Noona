/**
 * Covers debug controller behavior.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/LoggerService.java
 * - src/main/java/com/paxkun/raven/controller/DebugController.java
 * Times this file has been edited: 2
 */
package com.paxkun.raven.controller;

import com.paxkun.raven.service.LoggerService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Covers debug controller behavior.
 */

@ExtendWith(MockitoExtension.class)
class DebugControllerTest {

    @Mock
    private LoggerService loggerService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new DebugController(loggerService)).build();
    }

    @Test
    void getDebugReturnsCurrentState() throws Exception {
        when(loggerService.isDebugEnabled()).thenReturn(true);

        mockMvc.perform(get("/v1/debug"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true));
    }

    @Test
    void postDebugUpdatesState() throws Exception {
        when(loggerService.isDebugEnabled()).thenReturn(true);

        mockMvc.perform(post("/v1/debug")
                        .contentType("application/json")
                        .content("{\"enabled\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true));

        verify(loggerService).setDebugEnabled(true);
    }

    @Test
    void postDebugRejectsInvalidPayload() throws Exception {
        mockMvc.perform(post("/v1/debug")
                        .contentType("application/json")
                        .content("{\"enabled\":\"maybe\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("enabled must be a boolean value."));

        verify(loggerService, never()).setDebugEnabled(true);
        verify(loggerService, never()).setDebugEnabled(false);
    }
}
