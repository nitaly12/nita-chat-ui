/**
 * Paste into your Spring Boot project (adjust package, entity names, and field names).
 *
 * Goal: Facebook-style discovery — return users who are NOT the current user and do NOT
 * already have a Friendship row with them in PENDING or ACCEPTED (and optionally RECEIVED).
 *
 * Assumptions (rename to match your schema):
 * - {@code Friendship} links {@code User requester} and {@code User receiver} (or user1/user2).
 * - {@code FriendshipStatus} enum: PENDING, ACCEPTED, ...
 * - {@code User} has {@code Long id}.
 */
// package com.example.user;

/*
import com.example.friendship.Friendship;
import com.example.friendship.FriendshipStatus;
import com.example.user.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, Long> {

  @Query("""
      select distinct u from User u
      where u.id <> :meId
        and not exists (
          select 1 from Friendship f
          where f.status in :activeStatuses
            and (
                 (f.requester.id = :meId and f.receiver.id = u.id)
              or (f.requester.id = u.id and f.receiver.id = :meId)
            )
        )
      """)
  List<User> findSuggestedUsersExcludingFriendships(
      @Param("meId") Long meId,
      @Param("activeStatuses") Collection<FriendshipStatus> activeStatuses);
}
*/

/*
// In a service, call:
List<FriendshipStatus> active = List.of(
    FriendshipStatus.PENDING,
    FriendshipStatus.ACCEPTED
    // include FriendshipStatus.RECEIVED if you model incoming requests as a row status
);
List<User> suggestions = userRepository.findSuggestedUsersExcludingFriendships(currentUser.getId(), active);
*/

/**
 * Native SQL variant (works if you prefer raw table names {@code friendships}, {@code users}):
 *
 * <pre>{@code
 * SELECT u.*
 * FROM users u
 * WHERE u.id <> :meId
 *   AND NOT EXISTS (
 *     SELECT 1
 *     FROM friendships f
 *     WHERE f.status IN ('PENDING', 'ACCEPTED')
 *       AND (
 *            (f.requester_id = :meId AND f.receiver_id = u.id)
 *         OR (f.requester_id = u.id AND f.receiver_id = :meId)
 *       )
 *   );
 * }</pre>
 *
 * Wire this into the controller that backs {@code GET /api/users} (or a dedicated
 * {@code GET /api/users/suggestions}) so the React app receives an already-filtered list.
 */

public final class UserDiscoveryQueryExample {
  private UserDiscoveryQueryExample() {}
}
