/**
 * Boundary that resolves a spec to a plain PicklistDependencySnapshot.
 *
 * Returns a ConnectApi-free snapshot deliberately: ConnectApi output classes are not
 * reliably constructible in Apex, so returning them would make the source impossible to
 * stub in a unit test. Production uses ConnectApiPicklistDependencySource; tests stub this
 * interface with hand-built snapshots.
 *
 * Implementations may throw; PicklistDependencyValidator catches per spec and records a
 * LOOKUP_ERROR rather than aborting the remaining specs.
 */
public interface IPicklistDependencySource {
    PicklistDependencySnapshot fetch(PicklistDependencySpec spec);
}
