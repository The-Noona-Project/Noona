import {Suspense} from "react";
import {KavitaLoginBridgePage} from "@/components/noona/KavitaLoginBridgePage";

export default function Page() {
    return (
        <Suspense fallback={null}>
            <KavitaLoginBridgePage/>
        </Suspense>
    );
}
