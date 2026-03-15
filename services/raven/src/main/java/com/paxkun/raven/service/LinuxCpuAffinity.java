/**
 * Encapsulates Raven linux cpu affinity behavior.
 * Related files:
 * - None yet.
 * Times this file has been edited: 2
 */
package com.paxkun.raven.service;

import com.sun.jna.Library;
import com.sun.jna.Native;
import com.sun.jna.Structure;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Linux-only process affinity helper backed by sched_getaffinity and
 * sched_setaffinity.
 */
@Component
public class LinuxCpuAffinity {

    private static final int CPU_SET_WORDS = 16;

    /**
     * Applies current process affinity.
     *
     * @param cpuCoreId The CPU core id.
     * @return The resulting AffinityResult.
     */

    public AffinityResult applyCurrentProcessAffinity(int cpuCoreId) {
        if (cpuCoreId < 0 || !isSupported()) {
            return AffinityResult.unsupported();
        }

        CpuSet cpuSet = new CpuSet();
        cpuSet.zero();
        cpuSet.set(cpuCoreId);
        cpuSet.write();

        int rc = LinuxCLib.INSTANCE.sched_setaffinity(0, cpuSet.size(), cpuSet);
        if (rc != 0) {
            return AffinityResult.failure(Native.getLastError());
        }

        return AffinityResult.success();
    }

    /**
     * Returns available cpu ids.
     *
     * @return The resulting list.
     */

    public List<Integer> getAvailableCpuIds() {
        if (!isSupported()) {
            return List.of();
        }

        CpuSet cpuSet = new CpuSet();
        cpuSet.zero();
        cpuSet.write();

        int rc = LinuxCLib.INSTANCE.sched_getaffinity(0, cpuSet.size(), cpuSet);
        if (rc != 0) {
            return List.of();
        }

        cpuSet.read();
        return cpuSet.toCpuIds();
    }

    /**
     * Indicates whether supported.
     *
     * @return True when the condition is satisfied.
     */

    public boolean isSupported() {
        String osName = System.getProperty("os.name", "");
        return osName != null && osName.toLowerCase(java.util.Locale.ROOT).contains("linux");
    }

    /**
     * Encapsulates Raven linux cpu affinity behavior.
     */

    interface LinuxCLib extends Library {
        LinuxCLib INSTANCE = Native.load("c", LinuxCLib.class);

        int sched_setaffinity(int pid, int cpuSetSize, CpuSet mask);

        int sched_getaffinity(int pid, int cpuSetSize, CpuSet mask);
    }

    /**
     * Encapsulates Raven linux cpu affinity behavior.
     *
     * @param applied The applied.
     * @param supported The supported.
     * @param errorCode The error code.
     */

    public record AffinityResult(boolean applied, boolean supported, Integer errorCode) {
        static AffinityResult success() {
            return new AffinityResult(true, true, null);
        }

        static AffinityResult unsupported() {
            return new AffinityResult(false, false, null);
        }

        static AffinityResult failure(int errorCode) {
            return new AffinityResult(false, true, errorCode);
        }
    }

    /**
     * Encapsulates Raven linux cpu affinity behavior.
     */

    @Structure.FieldOrder({"bits"})
    public static class CpuSet extends Structure {
        public long[] bits = new long[CPU_SET_WORDS];

        void zero() {
            Arrays.fill(bits, 0L);
        }

        void set(int cpuId) {
            if (cpuId < 0) {
                return;
            }

            int index = cpuId / Long.SIZE;
            int bit = cpuId % Long.SIZE;
            if (index < 0 || index >= bits.length) {
                return;
            }

            bits[index] |= 1L << bit;
        }

        List<Integer> toCpuIds() {
            List<Integer> cpuIds = new ArrayList<>();
            for (int wordIndex = 0; wordIndex < bits.length; wordIndex++) {
                long word = bits[wordIndex];
                if (word == 0L) {
                    continue;
                }

                for (int bitIndex = 0; bitIndex < Long.SIZE; bitIndex++) {
                    if ((word & (1L << bitIndex)) != 0L) {
                        cpuIds.add((wordIndex * Long.SIZE) + bitIndex);
                    }
                }
            }
            return cpuIds;
        }
    }
}
